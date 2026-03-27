import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import * as logs from 'aws-cdk-lib/aws-logs';

interface Props extends StackProps {
  stage: string;
  documentsBucket: s3.IBucket;
  mainTable: dynamodb.ITable;
  sentryDNS: string;
  pineconeApiKey: string;
}

/**
 * Answer Generation Pipeline - runs ONCE per project after all files are extracted.
 * 
 * Flow:
 * 1. PrepareQuestions - loads ALL questions, creates embeddings, clusters them
 * 2. Map: GenerateAnswer - generates answers for masters, skips non-masters
 * 3. CopyClusterAnswers - copies master answers to all cluster members
 */
export class AnswerGenerationPipelineStack extends Stack {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const { stage, documentsBucket, mainTable, sentryDNS, pineconeApiKey } = props;
    const prefix = `AutoRfp-${stage}-AnswerGen`;

    const sfLogGroup = new logs.LogGroup(this, `${prefix}-LogGroup`, {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const mkFnLogGroup = (name: string) =>
      new logs.LogGroup(this, `${prefix}-${name}-Logs`, {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      });

    const bedrockApiKeyParamArn = `arn:aws:ssm:us-east-1:${this.account}:parameter/auto-rfp/bedrock/api-key`;
    const auditHmacSecretParamArn = `arn:aws:ssm:us-east-1:${this.account}:parameter/auto-rfp/audit-hmac-secret-${stage.toLowerCase()}`;

    const commonLambdaEnv = {
      REGION: this.region,
      DB_TABLE_NAME: mainTable.tableName,
      DOCUMENTS_BUCKET: documentsBucket.bucketName,
      SENTRY_DSN: sentryDNS,
      SENTRY_ENVIRONMENT: stage,
      STAGE: stage,
    } as const;

    // Prepare Questions Lambda - loads all questions, embeds, clusters
    const prepareQuestionsLambda = new lambdaNode.NodejsFunction(this, 'PrepareQuestionsLambda', {
      runtime: lambda.Runtime.NODEJS_24_X,
      logGroup: mkFnLogGroup('PrepareQuestions'),
      entry: path.join(__dirname, '../../apps/functions/src/handlers/answer-pipeline/prepare-questions.ts'),
      handler: 'handler',
      timeout: Duration.minutes(10),
      memorySize: 1024,
      environment: {
        ...commonLambdaEnv,
        BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
        PINECONE_API_KEY: pineconeApiKey,
        PINECONE_INDEX: 'documents',
      },
    });
    mainTable.grantReadWriteData(prepareQuestionsLambda);
    documentsBucket.grantWrite(prepareQuestionsLambda); // Grant write access to write questions JSONL

    prepareQuestionsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      }),
    );
    prepareQuestionsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [bedrockApiKeyParamArn],
      }),
    );

    // Generate Answer Lambda - processes individual questions
    const generateAnswerLambda = new lambdaNode.NodejsFunction(this, 'GenerateAnswerLambda', {
      runtime: lambda.Runtime.NODEJS_24_X,
      logGroup: mkFnLogGroup('GenerateAnswer'),
      entry: path.join(__dirname, '../../apps/functions/src/handlers/answer-pipeline/generate-answer-pipeline.ts'),
      handler: 'handler',
      timeout: Duration.minutes(5),
      memorySize: 1024,
      environment: {
        ...commonLambdaEnv,
        BEDROCK_MODEL_ID: 'anthropic.claude-opus-4-6-v1',
        BEDROCK_REGION: 'us-east-1',
        BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
        PINECONE_API_KEY: pineconeApiKey,
        PINECONE_INDEX: 'documents',
      },
    });
    documentsBucket.grantRead(generateAnswerLambda);
    mainTable.grantReadWriteData(generateAnswerLambda);

    generateAnswerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      }),
    );
    generateAnswerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [bedrockApiKeyParamArn, auditHmacSecretParamArn],
      }),
    );

    // Copy Cluster Answers Lambda - copies master answers to members
    const copyClusterAnswersLambda = new lambdaNode.NodejsFunction(this, 'CopyClusterAnswersLambda', {
      runtime: lambda.Runtime.NODEJS_24_X,
      logGroup: mkFnLogGroup('CopyClusterAnswers'),
      entry: path.join(__dirname, '../../apps/functions/src/handlers/answer-pipeline/copy-cluster-answers.ts'),
      handler: 'handler',
      timeout: Duration.minutes(5),
      memorySize: 512,
      environment: commonLambdaEnv,
    });
    mainTable.grantReadWriteData(copyClusterAnswersLambda);

    // Step Function Definition
    const prepareQuestions = new tasks.LambdaInvoke(this, 'Prepare Questions', {
      lambdaFunction: prepareQuestionsLambda,
      payload: sfn.TaskInput.fromObject({
        projectId: sfn.JsonPath.stringAt('$.projectId'),
        orgId: sfn.JsonPath.stringAt('$.orgId'),
        opportunityId: sfn.JsonPath.stringAt('$.opportunityId'),
      }),
      resultPath: '$.prepareResult',
      payloadResponseOnly: true,
    });

    // Use Distributed Map to read questions from S3 and process in parallel
    // This avoids the 256KB payload limit by streaming from S3
    const generateAnswersMap = new sfn.DistributedMap(this, 'Generate Answers Map', {
      maxConcurrency: 5, // Reduced from 10 to avoid API throttling
      toleratedFailurePercentage: 80, // Increased from 50% to 80% - some questions may fail but pipeline continues
      itemReader: new sfn.S3JsonLItemReader({
        bucket: documentsBucket,
        key: sfn.JsonPath.stringAt('$.prepareResult.s3Key'),
      }),
      resultPath: sfn.JsonPath.DISCARD, // Discard results to avoid accumulating large payloads
    });

    generateAnswersMap.itemProcessor(
      new tasks.LambdaInvoke(this, 'Generate Answer', {
        lambdaFunction: generateAnswerLambda,
        payload: sfn.TaskInput.fromObject({
          // Map input is the individual question object from JSONL
          questionId: sfn.JsonPath.stringAt('$.questionId'),
          projectId: sfn.JsonPath.stringAt('$.projectId'),
          orgId: sfn.JsonPath.stringAt('$.orgId'),
          opportunityId: sfn.JsonPath.stringAt('$.opportunityId'),
          questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
          isClusterMaster: sfn.JsonPath.stringAt('$.isClusterMaster'),
          masterQuestionId: sfn.JsonPath.stringAt('$.masterQuestionId'),
        }),
        payloadResponseOnly: true,
        // Retry on transient errors (throttling, timeouts)
        retryOnServiceExceptions: true,
      }).addRetry({
        errors: ['States.TaskFailed', 'Lambda.ServiceException', 'Lambda.TooManyRequestsException'],
        interval: Duration.seconds(2),
        maxAttempts: 3,
        backoffRate: 2.0, // Exponential backoff: 2s, 4s, 8s
      }).addCatch(new sfn.Pass(this, 'Catch Answer Error'), {
        errors: ['States.ALL'],
        resultPath: '$.error',
      }),
    );

    const copyClusterAnswers = new tasks.LambdaInvoke(this, 'Copy Cluster Answers', {
      lambdaFunction: copyClusterAnswersLambda,
      payload: sfn.TaskInput.fromObject({
        projectId: sfn.JsonPath.stringAt('$.projectId'),
      }),
      resultPath: '$.copyClusterResult',
      payloadResponseOnly: true,
    });

    const done = new sfn.Succeed(this, 'Done');

    // Build the chain
    const definition = prepareQuestions
      .next(generateAnswersMap)
      .next(copyClusterAnswers)
      .next(done);

    this.stateMachine = new sfn.StateMachine(this, 'AnswerGenerationStateMachine', {
      stateMachineName: `${prefix}-Pipeline`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.minutes(120), // Longer timeout for large projects with Distributed Map
      logs: { destination: sfLogGroup, level: sfn.LogLevel.ERROR },
    });

    // Grant Step Functions read access to S3 for Distributed Map
    documentsBucket.grantRead(this.stateMachine);
  }
}
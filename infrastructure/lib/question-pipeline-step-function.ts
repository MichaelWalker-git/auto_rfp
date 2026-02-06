import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
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

export class QuestionExtractionPipelineStack extends Stack {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const { stage, documentsBucket, mainTable, sentryDNS, pineconeApiKey } = props;
    const prefix = `AutoRfp-${stage}-Question`;

    const sfLogGroup = new logs.LogGroup(this, `${prefix}-LogGroup`, {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const mkFnLogGroup = (name: string) =>
      new logs.LogGroup(this, `${prefix}-${name}-Logs`, {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      });

    const textractTopic = new sns.Topic(this, 'TextractCompletionTopic', {
      topicName: `${prefix}-TextractCompletion`,
    });

    const textractRole = new iam.Role(this, 'TextractServiceRole', {
      assumedBy: new iam.ServicePrincipal('textract.amazonaws.com'),
    });

    textractTopic.grantPublish(textractRole);

    const commonLambdaEnv = {
      REGION: this.region,
      DB_TABLE_NAME: mainTable.tableName,
      DOCUMENTS_BUCKET: documentsBucket.bucketName,
      SENTRY_DSN: sentryDNS,
      SENTRY_ENVIRONMENT: stage,
    } as const;

    const startTextractLambda = new lambdaNode.NodejsFunction(this, 'StartTextractLambda', {
      runtime: lambda.Runtime.NODEJS_24_X,
      logGroup: mkFnLogGroup('StartTextract'),
      entry: path.join(__dirname, '../lambda/question-pipeline/start-question-textract.ts'),
      handler: 'handler',
      timeout: Duration.seconds(30),
      environment: {
        ...commonLambdaEnv,
        TEXTRACT_ROLE_ARN: textractRole.roleArn,
        TEXTRACT_SNS_TOPIC_ARN: textractTopic.topicArn,
      },
    });
    documentsBucket.grantRead(startTextractLambda);
    mainTable.grantReadWriteData(startTextractLambda);

    startTextractLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:StartDocumentTextDetection'],
        resources: ['*'],
      }),
    );
    startTextractLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [textractRole.roleArn],
      }),
    );

    const callbackLambda = new lambdaNode.NodejsFunction(this, 'TextractCallbackLambda', {
      runtime: lambda.Runtime.NODEJS_24_X,
      logGroup: mkFnLogGroup('TextractCallback'),
      entry: path.join(__dirname, '../lambda/question-pipeline/textract-question-callback.ts'),
      handler: 'handler',
      timeout: Duration.seconds(30),
      environment: commonLambdaEnv,
    });

    callbackLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
        resources: ['*'],
      }),
    );
    mainTable.grantReadWriteData(callbackLambda);
    textractTopic.addSubscription(new subs.LambdaSubscription(callbackLambda));

    const extractDocxTextLambda = new lambdaNode.NodejsFunction(this, 'ExtractDocxTextLambda', {
      runtime: lambda.Runtime.NODEJS_24_X,
      logGroup: mkFnLogGroup('ExtractDocxText'),
      entry: path.join(__dirname, '../lambda/question-pipeline/extract-docx-text.ts'),
      handler: 'handler',
      timeout: Duration.seconds(30),
      environment: commonLambdaEnv,
    });
    documentsBucket.grantReadWrite(extractDocxTextLambda);
    mainTable.grantReadWriteData(extractDocxTextLambda);

    const processResultLambda = new lambdaNode.NodejsFunction(this, 'ProcessQuestionFileLambda', {
      runtime: lambda.Runtime.NODEJS_24_X,
      logGroup: mkFnLogGroup('ProcessQuestionFile'),
      entry: path.join(__dirname, '../lambda/question-pipeline/process-question-file.ts'),
      handler: 'handler',
      timeout: Duration.minutes(3),
      environment: commonLambdaEnv,
    });
    documentsBucket.grantReadWrite(processResultLambda);
    mainTable.grantReadWriteData(processResultLambda);

    processResultLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:GetDocumentTextDetection'],
        resources: ['*'],
      }),
    );

    const extractQuestionsLambda = new lambdaNode.NodejsFunction(this, 'ExtractQuestionsLambda', {
      runtime: lambda.Runtime.NODEJS_24_X,
      logGroup: mkFnLogGroup('ExtractQuestions'),
      entry: path.join(__dirname, '../lambda/question-pipeline/extract-questions.ts'),
      handler: 'handler',
      timeout: Duration.minutes(5),
      environment: {
        ...commonLambdaEnv,
        BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
        BEDROCK_REGION: 'us-east-1',
      },
    });
    documentsBucket.grantRead(extractQuestionsLambda);
    mainTable.grantReadWriteData(extractQuestionsLambda);

    extractQuestionsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      }),
    );

    const bedrockApiKeyParamArn = `arn:aws:ssm:us-east-1:${this.account}:parameter/auto-rfp/bedrock/api-key`;
    extractQuestionsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [bedrockApiKeyParamArn],
      }),
    );

    // NEW: Fulfill Opportunity Fields Lambda (pipeline only, implementation later)
    const fulfillOpportunityFieldsLambda = new lambdaNode.NodejsFunction(
      this,
      'FulfillOpportunityFieldsLambda',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        logGroup: mkFnLogGroup('FulfillOpportunityFields'),
        entry: path.join(__dirname, '../lambda/question-pipeline/fulfill-opportunity-fields.ts'),
        handler: 'handler',
        timeout: Duration.minutes(2),
        environment: {
          ...commonLambdaEnv,
          BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
          BEDROCK_REGION: 'us-east-1',
        }
      },
    );
    documentsBucket.grantRead(fulfillOpportunityFieldsLambda);
    mainTable.grantReadWriteData(fulfillOpportunityFieldsLambda);

    fulfillOpportunityFieldsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      }),
    );

    fulfillOpportunityFieldsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [bedrockApiKeyParamArn],
      }),
    );

    const unsupportedFileLambda = new lambdaNode.NodejsFunction(this, 'UnsupportedFileLambda', {
      runtime: lambda.Runtime.NODEJS_24_X,
      logGroup: mkFnLogGroup('UnsupportedFile'),
      entry: path.join(__dirname, '../lambda/question-pipeline/unsupported-file-type.ts'),
      handler: 'handler',
      timeout: Duration.seconds(15),
      environment: commonLambdaEnv,
    });
    mainTable.grantReadWriteData(unsupportedFileLambda);

    // Answer Generation Pipeline Lambdas
    const prepareQuestionsLambda = new lambdaNode.NodejsFunction(this, 'PrepareQuestionsLambda', {
      runtime: lambda.Runtime.NODEJS_24_X,
      logGroup: mkFnLogGroup('PrepareQuestions'),
      entry: path.join(__dirname, '../lambda/answer-pipeline/prepare-questions.ts'),
      handler: 'handler',
      timeout: Duration.minutes(2),
      environment: commonLambdaEnv,
    });
    mainTable.grantReadData(prepareQuestionsLambda);

    const generateAnswerPipelineLambda = new lambdaNode.NodejsFunction(this, 'GenerateAnswerPipelineLambda', {
      runtime: lambda.Runtime.NODEJS_24_X,
      logGroup: mkFnLogGroup('GenerateAnswerPipeline'),
      entry: path.join(__dirname, '../lambda/answer-pipeline/generate-answer-pipeline.ts'),
      handler: 'handler',
      timeout: Duration.minutes(5),
      memorySize: 1024,
      environment: {
        ...commonLambdaEnv,
        BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
        BEDROCK_REGION: 'us-east-1',
        BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
        PINECONE_API_KEY: pineconeApiKey,
        PINECONE_INDEX: 'documents',
      },
    });
    documentsBucket.grantRead(generateAnswerPipelineLambda);
    mainTable.grantReadWriteData(generateAnswerPipelineLambda);

    generateAnswerPipelineLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      }),
    );
    generateAnswerPipelineLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [bedrockApiKeyParamArn],
      }),
    );

    const startTextract = new tasks.LambdaInvoke(this, 'Start Textract', {
      lambdaFunction: startTextractLambda,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        taskToken: sfn.JsonPath.taskToken,
        questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
        projectId: sfn.JsonPath.stringAt('$.projectId'),
        sourceFileKey: sfn.JsonPath.stringAt('$.sourceFileKey'),
        mimeType: sfn.JsonPath.stringAt('$.mimeType'),
        opportunityId: sfn.JsonPath.stringAt('$.oppId'),
      }),
      resultPath: '$.textract',
    });

    const processResult = new tasks.LambdaInvoke(this, 'Process Textract Result', {
      lambdaFunction: processResultLambda,
      payload: sfn.TaskInput.fromObject({
        questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
        projectId: sfn.JsonPath.stringAt('$.projectId'),
        jobId: sfn.JsonPath.stringAt('$.textract.jobId'),
        opportunityId: sfn.JsonPath.stringAt('$.oppId'),
      }),
      resultPath: '$.process',
      payloadResponseOnly: true,
    });

    const extractDocxText = new tasks.LambdaInvoke(this, 'Extract DOCX Text', {
      lambdaFunction: extractDocxTextLambda,
      payload: sfn.TaskInput.fromObject({
        bucket: documentsBucket.bucketName,
        sourceFileKey: sfn.JsonPath.stringAt('$.sourceFileKey'),
        questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
        projectId: sfn.JsonPath.stringAt('$.projectId'),
        opportunityId: sfn.JsonPath.stringAt('$.oppId'),
      }),
      resultPath: '$.process',
      payloadResponseOnly: true,
    });

    const unsupportedFile = new tasks.LambdaInvoke(this, 'Unsupported File Type', {
      lambdaFunction: unsupportedFileLambda,
      payload: sfn.TaskInput.fromObject({
        questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
        projectId: sfn.JsonPath.stringAt('$.projectId'),
        opportunityId: sfn.JsonPath.stringAt('$.oppId'),
      }),
      resultPath: '$.unsupported',
      payloadResponseOnly: true,
    });

    const failUnsupported = new sfn.Fail(this, 'Fail - Unsupported file type', {
      error: 'UnsupportedFileType',
      cause: sfn.JsonPath.stringAt('$.unsupported.reason'),
    });

    // IMPORTANT: do NOT reuse the same State instance across branches.
    // NEW: Fulfill Opportunity Fields tasks (one per branch)
    const fulfillOppAfterPdf = new tasks.LambdaInvoke(this, 'Fulfill Opportunity Fields (PDF)', {
      lambdaFunction: fulfillOpportunityFieldsLambda,
      payload: sfn.TaskInput.fromObject({
        questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
        projectId: sfn.JsonPath.stringAt('$.projectId'),
        textFileKey: sfn.JsonPath.stringAt('$.process.textFileKey'),
        opportunityId: sfn.JsonPath.stringAt('$.oppId'),
      }),
      resultPath: sfn.JsonPath.DISCARD,
      payloadResponseOnly: true,
    });

    const fulfillOppAfterDocx = new tasks.LambdaInvoke(this, 'Fulfill Opportunity Fields (DOCX)', {
      lambdaFunction: fulfillOpportunityFieldsLambda,
      payload: sfn.TaskInput.fromObject({
        questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
        projectId: sfn.JsonPath.stringAt('$.projectId'),
        textFileKey: sfn.JsonPath.stringAt('$.process.textFileKey'),
        opportunityId: sfn.JsonPath.stringAt('$.oppId'),
      }),
      resultPath: sfn.JsonPath.DISCARD,
      payloadResponseOnly: true,
    });

    // Existing: Extract Questions tasks (one per branch) - now capture results
    const extractQuestionsAfterPdf = new tasks.LambdaInvoke(this, 'Extract Questions from Text (PDF)', {
      lambdaFunction: extractQuestionsLambda,
      payload: sfn.TaskInput.fromObject({
        questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
        projectId: sfn.JsonPath.stringAt('$.projectId'),
        textFileKey: sfn.JsonPath.stringAt('$.process.textFileKey'),
        opportunityId: sfn.JsonPath.stringAt('$.oppId'),
      }),
      resultPath: '$.extractResult',
      payloadResponseOnly: true,
    });

    const extractQuestionsAfterDocx = new tasks.LambdaInvoke(this, 'Extract Questions from Text (DOCX)', {
      lambdaFunction: extractQuestionsLambda,
      payload: sfn.TaskInput.fromObject({
        questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
        projectId: sfn.JsonPath.stringAt('$.projectId'),
        textFileKey: sfn.JsonPath.stringAt('$.process.textFileKey'),
        opportunityId: sfn.JsonPath.stringAt('$.oppId'),
      }),
      resultPath: '$.extractResult',
      payloadResponseOnly: true,
    });

    // Answer Generation: Prepare Questions tasks (one per branch)
    const prepareQuestions = new tasks.LambdaInvoke(this, 'Prepare Questions for Answers', {
      lambdaFunction: prepareQuestionsLambda,
      payload: sfn.TaskInput.fromObject({
        projectId: sfn.JsonPath.stringAt('$.projectId'),
        questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
      }),
      resultPath: '$.prepareResult',
      payloadResponseOnly: true,
    });

    const generateAnswersMap = new sfn.Map(this, 'Generate Answers Map', {
      itemsPath: '$.prepareResult.questions',
      maxConcurrency: 5,
      resultPath: '$.answersResult',
    });

    generateAnswersMap.itemProcessor(
      new tasks.LambdaInvoke(this, 'Generate Answer', {
        lambdaFunction: generateAnswerPipelineLambda,
        payloadResponseOnly: true,
      }).addCatch(new sfn.Pass(this, 'Catch Answer Error'), {
        errors: ['States.ALL'],
        resultPath: '$.error',
      }),
    );

    const done = new sfn.Succeed(this, 'Done');

    const shouldGenerateAnswers = sfn.Condition.and(
      sfn.Condition.numberGreaterThan('$.extractResult.count', 0),
      sfn.Condition.booleanEquals('$.extractResult.cancelled', false),
    );

    const checkAnswerGeneration = new sfn.Choice(this, 'Should Generate Answers?')
      .when(shouldGenerateAnswers, prepareQuestions)
      .otherwise(done);

    prepareQuestions.next(generateAnswersMap).next(done);

    const isDocx = sfn.Condition.or(
      sfn.Condition.stringEquals(
        '$.mimeType',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
      sfn.Condition.stringMatches('$.sourceFileKey', '*.docx'),
      sfn.Condition.stringMatches('$.sourceFileKey', '*.DOCX'),
    );

    const isTextractSupported = sfn.Condition.or(
      sfn.Condition.stringEquals('$.mimeType', 'application/pdf'),
      sfn.Condition.stringMatches('$.sourceFileKey', '*.pdf'),
      sfn.Condition.stringMatches('$.sourceFileKey', '*.PDF'),
      sfn.Condition.stringMatches('$.sourceFileKey', '*.png'),
      sfn.Condition.stringMatches('$.sourceFileKey', '*.PNG'),
      sfn.Condition.stringMatches('$.sourceFileKey', '*.jpg'),
      sfn.Condition.stringMatches('$.sourceFileKey', '*.JPG'),
      sfn.Condition.stringMatches('$.sourceFileKey', '*.jpeg'),
      sfn.Condition.stringMatches('$.sourceFileKey', '*.JPEG'),
      sfn.Condition.stringMatches('$.sourceFileKey', '*.tiff'),
      sfn.Condition.stringMatches('$.sourceFileKey', '*.TIFF'),
      sfn.Condition.stringMatches('$.sourceFileKey', '*.tif'),
      sfn.Condition.stringMatches('$.sourceFileKey', '*.TIF'),
    );

    const pdfBranch = sfn.Chain.start(startTextract)
      .next(processResult)
      .next(fulfillOppAfterPdf)
      .next(extractQuestionsAfterPdf)
      .next(checkAnswerGeneration);

    const docxBranch = sfn.Chain.start(extractDocxText)
      .next(fulfillOppAfterDocx)
      .next(extractQuestionsAfterDocx)
      .next(checkAnswerGeneration);

    const unsupportedBranch = sfn.Chain.start(unsupportedFile).next(failUnsupported);

    const definition = new sfn.Choice(this, 'Route by file type')
      .when(isDocx, docxBranch)
      .when(isTextractSupported, pdfBranch)
      .otherwise(unsupportedBranch);

    this.stateMachine = new sfn.StateMachine(this, 'QuestionExtractionStateMachine', {
      stateMachineName: `${prefix}-Pipeline`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.minutes(30),
      logs: { destination: sfLogGroup, level: sfn.LogLevel.ERROR },
    });
  }
}
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
}

export class QuestionExtractionPipelineStack extends Stack {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const { stage, documentsBucket, mainTable, sentryDNS } = props;
    const prefix = `AutoRfp-${stage}-Question`;

    const logGroup = new logs.LogGroup(this, `${prefix}-LogGroup`, {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    //
    // ------------------------------------------------------------
    //  SNS Topics (FIXED)
    // ------------------------------------------------------------
    //
    const textractTopic = new sns.Topic(this, 'TextractCompletionTopic', {
      topicName: `${prefix}-TextractCompletion`,
    });

    //
    // Textract Role
    //
    const textractRole = new iam.Role(this, 'TextractServiceRole', {
      assumedBy: new iam.ServicePrincipal('textract.amazonaws.com'),
    });

    textractTopic.grantPublish(textractRole);

    //
    // ------------------------------------------------------------
    //  Lambdas
    // ------------------------------------------------------------
    //

    //
    // StartTextract Lambda
    //
    const startTextractLambda = new lambdaNode.NodejsFunction(
      this,
      'StartTextractLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../lambda/question-pipeline/start-question-textract.ts'),
        handler: 'handler',
        timeout: Duration.seconds(30),
        environment: {
          DB_TABLE_NAME: mainTable.tableName,
          DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
          TEXTRACT_ROLE_ARN: textractRole.roleArn,
          TEXTRACT_SNS_TOPIC_ARN: textractTopic.topicArn,
          SENTRY_DSN: sentryDNS,
          SENTRY_ENVIRONMENT: stage,
        },
        logGroup,
      }
    );
    documentsBucket.grantRead(startTextractLambda);
    mainTable.grantReadWriteData(startTextractLambda);

    startTextractLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:StartDocumentTextDetection'],
        resources: ['*'],
      })
    );

    startTextractLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [textractRole.roleArn],
      })
    );

    //
    // Callback Lambda (Textract + StepFunction token)
    //
    const callbackLambda = new lambdaNode.NodejsFunction(
      this,
      'TextractCallbackLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../lambda/question-pipeline/textract-question-callback.ts'),
        handler: 'handler',
        timeout: Duration.seconds(30),
        environment: {
          DB_TABLE_NAME: mainTable.tableName,
          SENTRY_DSN: sentryDNS,
          SENTRY_ENVIRONMENT: stage,
        },
        logGroup,
      }
    );

    callbackLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
        resources: ['*'],
      })
    );

    mainTable.grantReadWriteData(callbackLambda);

    textractTopic.addSubscription(
      new subs.LambdaSubscription(callbackLambda)
    );

    //
    // process-question-file Lambda
    //
    const processResultLambda = new lambdaNode.NodejsFunction(
      this,
      'ProcessQuestionFileLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../lambda/question-pipeline/process-question-file.ts'),
        handler: 'handler',
        timeout: Duration.minutes(3),
        environment: {
          DB_TABLE_NAME: mainTable.tableName,
          DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
          REGION: this.region,
          SENTRY_DSN: sentryDNS,
          SENTRY_ENVIRONMENT: stage,
        },
        logGroup,
      }
    );
    documentsBucket.grantReadWrite(processResultLambda);
    mainTable.grantReadWriteData(processResultLambda);
    processResultLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:GetDocumentTextDetection'],
        resources: ['*'],
      }),
    );
    processResultLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`*`],
      }),
    );

    //
    // extract-questions Lambda
    //
    const extractQuestionsLambda = new lambdaNode.NodejsFunction(
      this,
      'ExtractQuestionsLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../lambda/question-pipeline/extract-questions.ts'),
        handler: 'handler',
        timeout: Duration.minutes(2),
        environment: {
          DB_TABLE_NAME: mainTable.tableName,
          DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
          BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
          BEDROCK_REGION: 'us-east-1',
          SENTRY_DSN: sentryDNS,
          SENTRY_ENVIRONMENT: stage
        },
        logGroup,
      }
    );
    documentsBucket.grantRead(extractQuestionsLambda);
    mainTable.grantReadWriteData(extractQuestionsLambda);
    extractQuestionsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`*`],
      }),
    )


    const startTextract = new tasks.LambdaInvoke(
      this,
      'Start Textract',
      {
        lambdaFunction: startTextractLambda,
        integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
        payload: sfn.TaskInput.fromObject({
          taskToken: sfn.JsonPath.taskToken,
          questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
          projectId: sfn.JsonPath.stringAt('$.projectId'),
        }),
        resultPath: '$.textract',
      }
    );

    const processResult = new tasks.LambdaInvoke(
      this,
      'Process Textract Result',
      {
        lambdaFunction: processResultLambda,
        payload: sfn.TaskInput.fromObject({
          questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
          projectId: sfn.JsonPath.stringAt('$.projectId'),
          jobId: sfn.JsonPath.stringAt('$.textract.jobId'),
        }),
        resultPath: '$.process',
        payloadResponseOnly: true,
      }
    );

    const extractQuestions = new tasks.LambdaInvoke(
      this,
      'Extract Questions from Text',
      {
        lambdaFunction: extractQuestionsLambda,
        payload: sfn.TaskInput.fromObject({
          questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
          projectId: sfn.JsonPath.stringAt('$.projectId'),
          textFileKey: sfn.JsonPath.stringAt('$.process.textFileKey'),
        }),
        resultPath: sfn.JsonPath.DISCARD,
      }
    );

    const definition = startTextract
      .next(processResult)
      .next(extractQuestions)
      .next(new sfn.Succeed(this, 'Done'));


    this.stateMachine = new sfn.StateMachine(
      this,
      'QuestionExtractionStateMachine',
      {
        stateMachineName: `${prefix}-Pipeline`,
        definitionBody: sfn.DefinitionBody.fromChainable(definition),
        timeout: Duration.minutes(30),
      }
    );
  }
}

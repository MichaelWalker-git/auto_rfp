import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as path from 'path';

interface QuestionExtractionPipelineStackProps extends StackProps {
  stage: string;
  documentsBucket: s3.IBucket;        // same bucket you already use
  mainTable: dynamodb.ITable;         // table that stores question_file
}

export class QuestionExtractionPipelineStack extends Stack {
  public readonly stateMachine: sfn.StateMachine;

  constructor(
    scope: Construct,
    id: string,
    props: QuestionExtractionPipelineStackProps,
  ) {
    super(scope, id, props);

    const { stage, documentsBucket, mainTable } = props;
    const namePrefix = `AutoRfp-${stage}-Question`;

    // 1) SNS Topic + Textract service role
    const textractTopic = new sns.Topic(this, 'QuestionTextractTopic', {
      topicName: `${namePrefix}-TextractCompletionTopic`,
    });

    const textractServiceRole = new iam.Role(
      this,
      'QuestionTextractServiceRole',
      {
        assumedBy: new iam.ServicePrincipal('textract.amazonaws.com'),
        roleName: `${namePrefix}-TextractServiceRole`,
      },
    );

    textractTopic.grantPublish(textractServiceRole);

    // 2) Lambda – Start Textract for question file
    const startTextractLambda = new lambdaNode.NodejsFunction(
      this,
      'StartQuestionTextractLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(
          __dirname,
          '../lambda/question-pipeline/start-question-textract.ts',
        ),
        handler: 'handler',
        timeout: Duration.seconds(30),
        functionName: `${namePrefix}-StartTextract`,
        environment: {
          DB_TABLE_NAME: mainTable.tableName,
          DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
          SNS_TOPIC_ARN: textractTopic.topicArn,
          TEXTRACT_ROLE_ARN: textractServiceRole.roleArn,
        },
      },
    );

    mainTable.grantReadWriteData(startTextractLambda);
    documentsBucket.grantRead(startTextractLambda);
    startTextractLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:StartDocumentTextDetection'],
        resources: ['*'],
      }),
    );
    startTextractLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [textractServiceRole.roleArn],
      }),
    );

    // 3) Callback handler lambda (Textract SNS → Step Functions)
    const callbackHandlerLambda = new lambdaNode.NodejsFunction(
      this,
      'QuestionTextractCallbackHandler',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(
          __dirname,
          '../lambda/question-pipeline/textract-question-callback.ts',
        ),
        handler: 'handler',
        timeout: Duration.seconds(15),
        functionName: `${namePrefix}-TextractCallbackHandler`,
        environment: {
          DB_TABLE_NAME: mainTable.tableName,
        },
      },
    );

    callbackHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
        resources: ['*'],
      }),
    );

    mainTable.grantReadWriteData(callbackHandlerLambda);

    textractTopic.addSubscription(
      new subscriptions.LambdaSubscription(callbackHandlerLambda, {
        filterPolicy: {
          Status: sns.SubscriptionFilter.stringFilter({
            allowlist: ['SUCCEEDED', 'FAILED', 'PARTIAL_SUCCESS'],
          }),
        },
      }),
    );

    // 4) Lambda – Process Textract result: store text in S3 + update question_file
    const processResultLambda = new lambdaNode.NodejsFunction(
      this,
      'ProcessQuestionTextractResultLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(
          __dirname,
          '../lambda/question-pipeline/process-question-file.ts',
        ),
        handler: 'handler',
        timeout: Duration.minutes(5),
        memorySize: 1536,
        functionName: `${namePrefix}-ProcessResult`,
        environment: {
          DB_TABLE_NAME: mainTable.tableName,
          DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
          REGION: this.region,
        },
      },
    );

    mainTable.grantReadWriteData(processResultLambda);
    documentsBucket.grantReadWrite(processResultLambda);
    processResultLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:GetDocumentTextDetection'],
        resources: ['*'],
      }),
    );

    // 5) Lambda – Extract questions from textFile via Bedrock
    const extractQuestionsLambda = new lambdaNode.NodejsFunction(
      this,
      'ExtractQuestionsLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(
          __dirname,
          '../lambda/question-pipeline/extract-questions.ts',
        ),
        handler: 'handler',
        timeout: Duration.minutes(2),
        functionName: `${namePrefix}-ExtractQuestions`,
        environment: {
          DB_TABLE_NAME: mainTable.tableName,
          DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
          BEDROCK_REGION: 'us-east-1',
          BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0', // or your inference profile ARN
        },
      },
    );

    mainTable.grantReadWriteData(extractQuestionsLambda);
    documentsBucket.grantRead(extractQuestionsLambda);
    extractQuestionsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      }),
    );

    // 6) State machine definition
    // Input: { questionFileId: string, projectId: string }
    const startTextractTask = new tasks.LambdaInvoke(
      this,
      'Start Textract For Question File',
      {
        lambdaFunction: startTextractLambda,
        resultPath: '$.TextractJob', // { questionFileId, projectId, jobId }
        payloadResponseOnly: true,
      },
    );

    const waitForTextractTask = new tasks.SnsPublish(
      this,
      'Wait For Textract Completion',
      {
        topic: textractTopic,
        integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
        message: sfn.TaskInput.fromObject({
          TaskToken: sfn.JsonPath.taskToken,
          JobId: sfn.JsonPath.stringAt('$.TextractJob.jobId'),
          QuestionFileId: sfn.JsonPath.stringAt(
            '$.TextractJob.questionFileId',
          ),
          ProjectId: sfn.JsonPath.stringAt('$.TextractJob.projectId'),
        }),
        subject: `${namePrefix}-TextractJobWaiting`,
      },
    );

    const processResultTask = new tasks.LambdaInvoke(
      this,
      'Process Textract Result (Save Text)',
      {
        lambdaFunction: processResultLambda,
        payload: sfn.TaskInput.fromObject({
          questionFileId: sfn.JsonPath.stringAt('$.TextractJob.questionFileId'),
          projectId: sfn.JsonPath.stringAt('$.TextractJob.projectId'),
          jobId: sfn.JsonPath.stringAt('$.TextractJob.jobId'),
        }),
        resultPath: '$.ProcessResult', // { questionFileId, projectId, textFileKey }
        payloadResponseOnly: true,
      },
    );

    const extractQuestionsTask = new tasks.LambdaInvoke(
      this,
      'Extract Questions From Text',
      {
        lambdaFunction: extractQuestionsLambda,
        payload: sfn.TaskInput.fromObject({
          questionFileId: sfn.JsonPath.stringAt('$.ProcessResult.questionFileId'),
          projectId: sfn.JsonPath.stringAt('$.ProcessResult.projectId'),
          textFileKey: sfn.JsonPath.stringAt('$.ProcessResult.textFileKey'),
        }),
        resultPath: sfn.JsonPath.DISCARD,
      },
    );

    const definition = startTextractTask
      .next(waitForTextractTask)
      .next(processResultTask)
      .next(extractQuestionsTask)
      .next(new sfn.Succeed(this, 'Question Extraction Succeeded'));

    this.stateMachine = new sfn.StateMachine(
      this,
      'QuestionExtractionStateMachine',
      {
        stateMachineName: `${namePrefix}-QuestionPipeline`,
        definitionBody: sfn.DefinitionBody.fromChainable(definition),
        timeout: Duration.minutes(30),
      },
    );
  }
}

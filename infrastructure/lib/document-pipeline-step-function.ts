import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as path from 'path';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';

interface DocumentPipelineStackProps extends StackProps {
  stage: string;
  documentsBucket: s3.IBucket;
  documentsTable: dynamodb.ITable;
  openSearchCollectionEndpoint: string;
  vpc: ec2.IVpc;
  vpcSecurityGroup: ec2.ISecurityGroup;
  sentryDNS: string;
}

export class DocumentPipelineStack extends Stack {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: DocumentPipelineStackProps) {
    super(scope, id, props);

    const {
      stage,
      documentsBucket,
      documentsTable,
      openSearchCollectionEndpoint,
      vpc,
      vpcSecurityGroup,
      sentryDNS,
    } = props;

    const namePrefix = `AutoRfp-${stage}`;

    // 1. SNS Topic + Textract role
    const textractTopic = new sns.Topic(this, 'TextractCompletionTopic', {
      topicName: `${namePrefix}-TextractCompletionTopic`,
    });

    const textractServiceRole = new iam.Role(this, 'TextractServiceRole', {
      assumedBy: new iam.ServicePrincipal('textract.amazonaws.com'),
      roleName: `${namePrefix}-TextractServiceRole`,
    });
    textractTopic.grantPublish(textractServiceRole);

    // 2. Lambda 1 – Start Textract Job (callback pattern target)
    const startTextractLambda = new lambdaNode.NodejsFunction(
      this,
      'StartTextractJobLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../lambda/textract/start-textract.ts'),
        handler: 'handler',
        timeout: Duration.seconds(30),
        functionName: `${namePrefix}-StartTextractJob`,
        environment: {
          DB_TABLE_NAME: documentsTable.tableName,
          DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
          SNS_TOPIC_ARN: textractTopic.topicArn,
          TEXTRACT_ROLE_ARN: textractServiceRole.roleArn,
          SENTRY_DSN: sentryDNS,
          SENTRY_ENVIRONMENT: sentryDNS,
          OPENSEARCH_INDEX: 'documents',
        },
        logRetention: logs.RetentionDays.ONE_WEEK,
      },
    );

    documentsTable.grantReadWriteData(startTextractLambda);
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

    // 3. Callback Handler Lambda
    const callbackHandlerLambda = new lambdaNode.NodejsFunction(
      this,
      'TextractCallbackHandler',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../lambda/textract/callback-handler.ts'),
        handler: 'handler',
        timeout: Duration.seconds(15),
        functionName: `${namePrefix}-TextractCallbackHandler`,
        environment: {
          DB_TABLE_NAME: documentsTable.tableName,
          SENTRY_DSN: sentryDNS,
          SENTRY_ENVIRONMENT: stage,
        },
        logRetention: logs.RetentionDays.ONE_WEEK,
      },
    );

    documentsTable.grantReadData(callbackHandlerLambda);

    callbackHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
        resources: ['*'],
      }),
    );

    textractTopic.addSubscription(
      new subscriptions.LambdaSubscription(callbackHandlerLambda),
    );

    // 4. Lambda 2 – Process Textract + Bedrock + AOSS
    const processResultLambda = new lambdaNode.NodejsFunction(
      this,
      'ProcessTextractResultLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../lambda/textract/process-result.ts'),
        handler: 'handler',
        memorySize: 2048,
        timeout: Duration.minutes(5),
        functionName: `${namePrefix}-ProcessTextractResult`,
        vpc,
        securityGroups: [vpcSecurityGroup],
        environment: {
          DOCUMENTS_BUCKET: documentsBucket.bucketName,
          DOCUMENTS_TABLE_NAME: documentsTable.tableName,
          OPENSEARCH_ENDPOINT: openSearchCollectionEndpoint,
          REGION: this.region,
          SENTRY_DSN: sentryDNS,
          SENTRY_ENVIRONMENT: stage,
        },
        logRetention: logs.RetentionDays.ONE_WEEK,
      },
    );

    documentsTable.grantWriteData(processResultLambda);

    processResultLambda.role?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        'service-role/AWSLambdaVPCAccessExecutionRole',
      ),
    );

    processResultLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:GetDocumentTextDetection'],
        resources: ['*'],
      }),
    );

    processResultLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:*'],
        resources: ['*'],
      }),
    )

    processResultLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:*'],
        resources: ['*'],
      }),
    )

    processResultLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'aoss:APIAccessAll',
        ],
        resources: [
          'arn:aws:aoss:us-east-1:039885961427:collection/leb5aji6vthaxk7ft8pi',
        ],
      }),
    );

    processResultLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/*`],
      }),
    );

    processResultLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['aoss:APIAccess'],
        resources: ['*'],
      }),
    );

    // 5. Step Functions Logging
    const sfnLogGroup = new logs.LogGroup(
      this,
      'DocumentPipelineStateMachineLogs',
      {
        retention: logs.RetentionDays.ONE_WEEK,
      },
    );

    // 6. State Machine definition (Lambda callback pattern)

    // Input to state machine:
    //   { "documentId": "...", "knowledgeBaseId": "..." }  (kbId only used by process-result; start-textract derives it from SK if needed)
    //
    // StartTextractJob (WAIT_FOR_TASK_TOKEN):
    //   - SFN passes taskToken + documentId
    //   - lambda starts Textract, stores taskToken in Dynamo
    //   - SFN waits until callback-handler calls SendTaskSuccess with that token
    //
    // callback-handler output (SendTaskSuccess.output) is:
    //   { jobId, documentId, knowledgeBaseId, status }
    // stored under $.TextractJob

    const startTextractTask = new tasks.LambdaInvoke(
      this,
      'Start Textract Job',
      {
        lambdaFunction: startTextractLambda,
        integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
        payload: sfn.TaskInput.fromObject({
          taskToken: sfn.JsonPath.taskToken,
          documentId: sfn.JsonPath.stringAt('$.documentId'),
        }),
        resultPath: '$.TextractJob',
      },
    );

    const processResultTask = new tasks.LambdaInvoke(
      this,
      'Process Results and Index',
      {
        lambdaFunction: processResultLambda,
        payload: sfn.TaskInput.fromObject({
          documentId: sfn.JsonPath.stringAt('$.TextractJob.documentId'),
          jobId: sfn.JsonPath.stringAt('$.TextractJob.jobId'),
          knowledgeBaseId: sfn.JsonPath.stringAt(
            '$.TextractJob.knowledgeBaseId',
          ),
        }),
        resultPath: sfn.JsonPath.DISCARD,
      },
    );

    const definition = startTextractTask
      .next(processResultTask)
      .next(new sfn.Succeed(this, 'Pipeline Succeeded'));

    this.stateMachine = new sfn.StateMachine(
      this,
      'DocumentProcessingStateMachine',
      {
        stateMachineName: `${namePrefix}-DocumentPipeline`,
        definitionBody: sfn.DefinitionBody.fromChainable(definition),
        timeout: Duration.minutes(30),
        logs: {
          destination: sfnLogGroup,
          level: sfn.LogLevel.ALL,
          includeExecutionData: true,
        },
      },
    );
  }
}

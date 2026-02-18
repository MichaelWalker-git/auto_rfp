import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
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
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';

interface DocumentPipelineStackProps extends StackProps {
  stage: string;
  documentsBucket: s3.IBucket;
  documentsTable: dynamodb.ITable;
  vpc: ec2.IVpc;
  vpcSecurityGroup: ec2.ISecurityGroup;
  sentryDNS: string;
  pineconeApiKey: string;
}

export class DocumentPipelineStack extends Stack {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: DocumentPipelineStackProps) {
    super(scope, id, props);

    const {
      stage,
      documentsBucket,
      documentsTable,
      vpc,
      vpcSecurityGroup,
      sentryDNS,
      pineconeApiKey,
    } = props;

    const namePrefix = `AutoRfp-${stage}`;

    const logGroup = new logs.LogGroup(this, `${namePrefix}-LogGroup`, {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // 1) SNS Topic + Textract role
    const textractTopic = new sns.Topic(this, 'TextractCompletionTopic', {
      topicName: `${namePrefix}-TextractCompletionTopic`,
    });

    const textractServiceRole = new iam.Role(this, 'TextractServiceRole', {
      assumedBy: new iam.ServicePrincipal('textract.amazonaws.com'),
    });
    textractTopic.grantPublish(textractServiceRole);

    // 2) start-processing (sync): loads document row, sets status STARTED, returns format
    const startProcessingLambda = new nodejs.NodejsFunction(
      this,
      'StartProcessingLambda',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: path.join(__dirname, '../../apps/functions/src/handlers/document-pipeline-steps/start-processing.ts'),
        handler: 'handler',
        timeout: Duration.seconds(30),
        functionName: `${namePrefix}-StartProcessing`,
        environment: {
          REGION: this.region,
          DB_TABLE_NAME: documentsTable.tableName,
          DOCUMENTS_BUCKET: documentsBucket.bucketName,
          SENTRY_DSN: sentryDNS,
          SENTRY_ENVIRONMENT: stage,
          BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
          PINECONE_API_KEY: pineconeApiKey,
          PINECONE_INDEX: 'documents',
        },
        logGroup,
      },
    );
    documentsTable.grantReadWriteData(startProcessingLambda);

    // 3) pdf-processing (WAIT_FOR_TASK_TOKEN): starts Textract, stores jobId + taskToken
    const pdfProcessingLambda = new nodejs.NodejsFunction(
      this,
      'PdfProcessingLambda',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: path.join(__dirname, '../../apps/functions/src/handlers/document-pipeline-steps/pdf-processing.ts'),
        handler: 'handler',
        timeout: Duration.seconds(30),
        functionName: `${namePrefix}-PdfProcessing`,
        environment: {
          REGION: this.region,
          DB_TABLE_NAME: documentsTable.tableName,
          DOCUMENTS_BUCKET: documentsBucket.bucketName,
          TEXTRACT_SNS_TOPIC_ARN: textractTopic.topicArn,
          TEXTRACT_ROLE_ARN: textractServiceRole.roleArn,
          SENTRY_DSN: sentryDNS,
          SENTRY_ENVIRONMENT: stage,
          BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
          PINECONE_API_KEY: pineconeApiKey,
          PINECONE_INDEX: 'documents',
        },
        logGroup,
      },
    );
    documentsTable.grantReadWriteData(pdfProcessingLambda);
    documentsBucket.grantRead(pdfProcessingLambda);

    pdfProcessingLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:StartDocumentTextDetection'],
        resources: ['*'],
      }),
    );
    pdfProcessingLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [textractServiceRole.roleArn],
      }),
    );

    // 4) textract-callback: fetches full text, stores txt to S3, updates Dynamo, SendTaskSuccess/Failure
    const textractCallbackLambda = new nodejs.NodejsFunction(
      this,
      'TextractCallbackLambda',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: path.join(__dirname, '../../apps/functions/src/handlers/document-pipeline-steps/textract-callback.ts'),
        handler: 'handler',
        timeout: Duration.minutes(2),
        functionName: `${namePrefix}-TextractCallback`,
        environment: {
          REGION: this.region,
          DB_TABLE_NAME: documentsTable.tableName,
          DOCUMENTS_BUCKET: documentsBucket.bucketName,
          SENTRY_DSN: sentryDNS,
          SENTRY_ENVIRONMENT: stage,
          BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
          PINECONE_API_KEY: pineconeApiKey,
          PINECONE_INDEX: 'documents',
        },
        logGroup,
      },
    );

    documentsTable.grantReadWriteData(textractCallbackLambda);
    documentsBucket.grantReadWrite(textractCallbackLambda);

    textractCallbackLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:GetDocumentTextDetection'],
        resources: ['*'],
      }),
    );

    textractTopic.addSubscription(
      new subscriptions.LambdaSubscription(textractCallbackLambda),
    );

    // 5) docx-processing (sync): downloads docx, converts to text, stores txt to S3, returns bucket/txtKey
    const docxProcessingLambda = new nodejs.NodejsFunction(
      this,
      'DocxProcessingLambda',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: path.join(__dirname, '../../apps/functions/src/handlers/document-pipeline-steps/docx-processing.ts'),
        handler: 'handler',
        memorySize: 2048,
        timeout: Duration.minutes(2),
        functionName: `${namePrefix}-DocxProcessing`,
        environment: {
          REGION: this.region,
          DB_TABLE_NAME: documentsTable.tableName,
          DOCUMENTS_BUCKET: documentsBucket.bucketName,
          SENTRY_DSN: sentryDNS,
          SENTRY_ENVIRONMENT: stage,
          BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
          PINECONE_API_KEY: pineconeApiKey,
          PINECONE_INDEX: 'documents',
        },
        logGroup,
      },
    );
    documentsTable.grantReadWriteData(docxProcessingLambda);
    documentsBucket.grantReadWrite(docxProcessingLambda);

    // 6) chunk-document (sync): reads txt, writes chunks next to it, returns items[]
    const chunkDocumentLambda = new nodejs.NodejsFunction(
      this,
      'ChunkDocumentLambda',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: path.join(__dirname, '../../apps/functions/src/handlers/document-pipeline-steps/chunk-document.ts'),
        handler: 'handler',
        memorySize: 2048,
        timeout: Duration.minutes(2),
        functionName: `${namePrefix}-ChunkDocument`,
        environment: {
          REGION: this.region,
          DB_TABLE_NAME: documentsTable.tableName,
          DOCUMENTS_BUCKET: documentsBucket.bucketName,
          SENTRY_DSN: sentryDNS,
          SENTRY_ENVIRONMENT: stage,
          CHUNK_MAX_CHARS: '2500',
          CHUNK_OVERLAP_CHARS: '250',
          CHUNK_MIN_CHARS: '200',
          BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
          PINECONE_API_KEY: pineconeApiKey,
          PINECONE_INDEX: 'documents',
        },
        logGroup,
      },
    );
    documentsTable.grantReadWriteData(chunkDocumentLambda);
    documentsBucket.grantReadWrite(chunkDocumentLambda);

    // 7) index-document (per chunk): embed + index to Pinecone (+ optional INDEXED update on last chunk)
    const indexDocumentLambda = new nodejs.NodejsFunction(
      this,
      'IndexDocumentLambda',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: path.join(__dirname, '../../apps/functions/src/handlers/document-pipeline-steps/index-document.ts'),
        handler: 'handler',
        memorySize: 2048,
        timeout: Duration.minutes(2),
        functionName: `${namePrefix}-IndexDocumentChunk`,
        vpc,
        securityGroups: [vpcSecurityGroup],
        environment: {
          DB_TABLE_NAME: documentsTable.tableName,
          DOCUMENTS_BUCKET: documentsBucket.bucketName,
          REGION: this.region,
          BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
          SENTRY_DSN: sentryDNS,
          SENTRY_ENVIRONMENT: stage,
          PINECONE_API_KEY: pineconeApiKey,
          PINECONE_INDEX: 'documents',
        },
        logGroup,
      },
    );

    documentsBucket.grantRead(indexDocumentLambda);
    documentsTable.grantReadWriteData(indexDocumentLambda);

    indexDocumentLambda.role?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        'service-role/AWSLambdaVPCAccessExecutionRole',
      ),
    );

    indexDocumentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/*`],
      }),
    );

    indexDocumentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['aoss:APIAccessAll'],
        resources: ['*'],
      }),
    );

    const bedrockApiKeyParamArn = `arn:aws:ssm:us-east-1:${this.account}:parameter/auto-rfp/bedrock/api-key`;

    indexDocumentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [bedrockApiKeyParamArn],
      }),
    );

    // 8) Step Functions logging
    const sfnLogGroup = new logs.LogGroup(
      this,
      'DocumentPipelineStateMachineLogs',
      {
        retention: logs.RetentionDays.ONE_WEEK,
      },
    );

    // Step Functions Tasks
    const startProcessingTask = new tasks.LambdaInvoke(this, 'Start Processing', {
      lambdaFunction: startProcessingLambda,
      payload: sfn.TaskInput.fromObject({
        orgId: sfn.JsonPath.stringAt('$.orgId'),
        documentId: sfn.JsonPath.stringAt('$.documentId'),
        knowledgeBaseId: sfn.JsonPath.stringAt('$.knowledgeBaseId'),
      }),
      resultSelector: {
        'format.$': '$.Payload.format',
        'fileKey.$': '$.Payload.fileKey',
        'contentType.$': '$.Payload.contentType',
        'ext.$': '$.Payload.ext',
        'knowledgeBaseId.$': '$.Payload.knowledgeBaseId',
        'status.$': '$.Payload.status',
        'documentId.$': '$.Payload.documentId',
        'orgId.$': '$.Payload.orgId',
      },
      resultPath: '$.Start',
    });

    const pdfProcessingTask = new tasks.LambdaInvoke(this, 'PDF Processing (Start Textract)', {
      lambdaFunction: pdfProcessingLambda,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        taskToken: sfn.JsonPath.taskToken,
        orgId: sfn.JsonPath.stringAt('$.orgId'),
        documentId: sfn.JsonPath.stringAt('$.documentId'),
        knowledgeBaseId: sfn.JsonPath.stringAt('$.knowledgeBaseId'),
      }),
      resultPath: '$.Pdf',
    });

    const docxProcessingTask = new tasks.LambdaInvoke(this, 'DOCX Processing (To Text)', {
      lambdaFunction: docxProcessingLambda,
      payload: sfn.TaskInput.fromObject({
        orgId: sfn.JsonPath.stringAt('$.orgId'),
        documentId: sfn.JsonPath.stringAt('$.documentId'),
        knowledgeBaseId: sfn.JsonPath.stringAt('$.knowledgeBaseId'),
        fileKey: sfn.JsonPath.stringAt('$.Start.fileKey'),
        bucket: documentsBucket.bucketName,
      }),
      resultSelector: {
        'orgId.$': '$.Payload.orgId',
        'documentId.$': '$.Payload.documentId',
        'knowledgeBaseId.$': '$.Payload.knowledgeBaseId',
        'status.$': '$.Payload.status',
        'bucket.$': '$.Payload.bucket',
        'txtKey.$': '$.Payload.txtKey',
        'textLength.$': '$.Payload.textLength',
      },
      resultPath: '$.Text',
    });

    const chunkPdfTask = new tasks.LambdaInvoke(this, 'Chunk Document (PDF)', {
      lambdaFunction: chunkDocumentLambda,
      payload: sfn.TaskInput.fromObject({
        orgId: sfn.JsonPath.stringAt('$.orgId'),
        documentId: sfn.JsonPath.stringAt('$.documentId'),
        knowledgeBaseId: sfn.JsonPath.stringAt('$.knowledgeBaseId'),
        bucket: sfn.JsonPath.stringAt('$.Pdf.bucket'),
        txtKey: sfn.JsonPath.stringAt('$.Pdf.txtKey'),
      }),
      resultSelector: {
        'orgId.$': '$.Payload.orgId',
        'documentId.$': '$.Payload.documentId',
        'knowledgeBaseId.$': '$.Payload.knowledgeBaseId',
        'bucket.$': '$.Payload.bucket',
        'txtKey.$': '$.Payload.txtKey',
        'chunksPrefix.$': '$.Payload.chunksPrefix',
        'chunksCount.$': '$.Payload.chunksCount',
        'items.$': '$.Payload.items',
      },
      resultPath: '$.Chunks',
    });

    const chunkDocxTask = new tasks.LambdaInvoke(this, 'Chunk Document (DOCX)', {
      lambdaFunction: chunkDocumentLambda,
      payload: sfn.TaskInput.fromObject({
        orgId: sfn.JsonPath.stringAt('$.orgId'),
        documentId: sfn.JsonPath.stringAt('$.documentId'),
        knowledgeBaseId: sfn.JsonPath.stringAt('$.knowledgeBaseId'),
        bucket: sfn.JsonPath.stringAt('$.Text.bucket'),
        txtKey: sfn.JsonPath.stringAt('$.Text.txtKey'),
      }),
      resultSelector: {
        'orgId.$': '$.Payload.orgId',
        'documentId.$': '$.Payload.documentId',
        'knowledgeBaseId.$': '$.Payload.knowledgeBaseId',
        'bucket.$': '$.Payload.bucket',
        'txtKey.$': '$.Payload.txtKey',
        'chunksPrefix.$': '$.Payload.chunksPrefix',
        'chunksCount.$': '$.Payload.chunksCount',
        'items.$': '$.Payload.items',
      },
      resultPath: '$.Chunks',
    });

    const indexPdfMap = new sfn.Map(this, 'Index Chunks (PDF)', {
      itemsPath: sfn.JsonPath.stringAt('$.Chunks.items'),
      maxConcurrency: 3,
      resultPath: sfn.JsonPath.DISCARD,
      itemSelector: {
        'chunkItem.$': '$$.Map.Item.Value',
        'orgId.$': '$.orgId',
        'documentId.$': '$.documentId',
        'knowledgeBaseId.$': '$.knowledgeBaseId',
        'totalChunks.$': '$.Chunks.chunksCount'
      },
    });

    indexPdfMap.iterator(
      new tasks.LambdaInvoke(this, 'Index One Chunk (PDF)', {
        lambdaFunction: indexDocumentLambda,
        payload: sfn.TaskInput.fromObject({
          orgId: sfn.JsonPath.stringAt('$.orgId'),
          documentId: sfn.JsonPath.stringAt('$.documentId'),
          knowledgeBaseId: sfn.JsonPath.stringAt('$.knowledgeBaseId'),
          chunkKey: sfn.JsonPath.stringAt('$.chunkItem.chunkKey'),
          index: sfn.JsonPath.numberAt('$.chunkItem.index'),
          totalChunks: sfn.JsonPath.numberAt('$.totalChunks'),
        }),
        resultPath: sfn.JsonPath.DISCARD,
      }),
    );

    const indexDocxMap = new sfn.Map(this, 'Index Chunks (DOCX)', {
      itemsPath: sfn.JsonPath.stringAt('$.Chunks.items'),
      maxConcurrency: 3,
      resultPath: sfn.JsonPath.DISCARD,
      itemSelector: {
        'chunkItem.$': '$$.Map.Item.Value',
        'orgId.$': '$.orgId',
        'documentId.$': '$.documentId',
        'knowledgeBaseId.$': '$.knowledgeBaseId',
        'totalChunks.$': '$.Chunks.chunksCount'
      },
    });

    indexDocxMap.iterator(
      new tasks.LambdaInvoke(this, 'Index One Chunk (DOCX)', {
        lambdaFunction: indexDocumentLambda,
        payload: sfn.TaskInput.fromObject({
          orgId: sfn.JsonPath.stringAt('$.orgId'),
          documentId: sfn.JsonPath.stringAt('$.documentId'),
          knowledgeBaseId: sfn.JsonPath.stringAt('$.knowledgeBaseId'),
          chunkKey: sfn.JsonPath.stringAt('$.chunkItem.chunkKey'),
          index: sfn.JsonPath.numberAt('$.chunkItem.index'),
          totalChunks: sfn.JsonPath.numberAt('$.totalChunks'),
        }),
        resultPath: sfn.JsonPath.DISCARD,
      }),
    );

    // XLSX processing Lambda
    const xlsxProcessingLambda = new nodejs.NodejsFunction(
      this,
      'XlsxProcessingLambda',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: path.join(__dirname, '../../apps/functions/src/handlers/document-pipeline-steps/xlsx-processing.ts'),
        handler: 'handler',
        memorySize: 2048,
        timeout: Duration.minutes(2),
        functionName: `${namePrefix}-XlsxProcessing`,
        environment: {
          REGION: this.region,
          DB_TABLE_NAME: documentsTable.tableName,
          DOCUMENTS_BUCKET: documentsBucket.bucketName,
          SENTRY_DSN: sentryDNS,
          SENTRY_ENVIRONMENT: stage,
          BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
          PINECONE_API_KEY: pineconeApiKey,
          PINECONE_INDEX: 'documents',
        },
        logGroup,
      },
    );
    documentsTable.grantReadWriteData(xlsxProcessingLambda);
    documentsBucket.grantReadWrite(xlsxProcessingLambda);

    const xlsxProcessingTask = new tasks.LambdaInvoke(this, 'XLSX Processing (To Text)', {
      lambdaFunction: xlsxProcessingLambda,
      payload: sfn.TaskInput.fromObject({
        orgId: sfn.JsonPath.stringAt('$.orgId'),
        documentId: sfn.JsonPath.stringAt('$.documentId'),
        knowledgeBaseId: sfn.JsonPath.stringAt('$.knowledgeBaseId'),
        fileKey: sfn.JsonPath.stringAt('$.Start.fileKey'),
        bucket: documentsBucket.bucketName,
      }),
      resultSelector: {
        'orgId.$': '$.Payload.orgId',
        'documentId.$': '$.Payload.documentId',
        'knowledgeBaseId.$': '$.Payload.knowledgeBaseId',
        'textFileKey.$': '$.Payload.textFileKey',
      },
      resultPath: '$.Text',
    });

    const chunkXlsxTask = new tasks.LambdaInvoke(this, 'Chunk Document (XLSX)', {
      lambdaFunction: chunkDocumentLambda,
      payload: sfn.TaskInput.fromObject({
        orgId: sfn.JsonPath.stringAt('$.orgId'),
        documentId: sfn.JsonPath.stringAt('$.documentId'),
        knowledgeBaseId: sfn.JsonPath.stringAt('$.knowledgeBaseId'),
        bucket: documentsBucket.bucketName,
        txtKey: sfn.JsonPath.stringAt('$.Text.textFileKey'),
      }),
      resultSelector: {
        'orgId.$': '$.Payload.orgId',
        'documentId.$': '$.Payload.documentId',
        'knowledgeBaseId.$': '$.Payload.knowledgeBaseId',
        'bucket.$': '$.Payload.bucket',
        'txtKey.$': '$.Payload.txtKey',
        'chunksPrefix.$': '$.Payload.chunksPrefix',
        'chunksCount.$': '$.Payload.chunksCount',
        'items.$': '$.Payload.items',
      },
      resultPath: '$.Chunks',
    });

    const indexXlsxMap = new sfn.Map(this, 'Index Chunks (XLSX)', {
      itemsPath: sfn.JsonPath.stringAt('$.Chunks.items'),
      maxConcurrency: 3,
      resultPath: sfn.JsonPath.DISCARD,
      itemSelector: {
        'chunkItem.$': '$$.Map.Item.Value',
        'orgId.$': '$.orgId',
        'documentId.$': '$.documentId',
        'knowledgeBaseId.$': '$.knowledgeBaseId',
        'totalChunks.$': '$.Chunks.chunksCount',
      },
    });

    indexXlsxMap.iterator(
      new tasks.LambdaInvoke(this, 'Index One Chunk (XLSX)', {
        lambdaFunction: indexDocumentLambda,
        payload: sfn.TaskInput.fromObject({
          orgId: sfn.JsonPath.stringAt('$.orgId'),
          documentId: sfn.JsonPath.stringAt('$.documentId'),
          knowledgeBaseId: sfn.JsonPath.stringAt('$.knowledgeBaseId'),
          chunkKey: sfn.JsonPath.stringAt('$.chunkItem.chunkKey'),
          index: sfn.JsonPath.numberAt('$.chunkItem.index'),
          totalChunks: sfn.JsonPath.numberAt('$.totalChunks'),
        }),
        resultPath: sfn.JsonPath.DISCARD,
      }),
    );

    const done = new sfn.Succeed(this, 'Pipeline Succeeded');

    const chooseFormat = new sfn.Choice(this, 'Choose File Format');

    const pdfBranch = pdfProcessingTask
      .next(chunkPdfTask)
      .next(indexPdfMap)
      .next(done);

    const docxBranch = docxProcessingTask
      .next(chunkDocxTask)
      .next(indexDocxMap)
      .next(done);

    const xlsxBranch = xlsxProcessingTask
      .next(chunkXlsxTask)
      .next(indexXlsxMap)
      .next(done);

    const definition = startProcessingTask.next(
      chooseFormat
        .when(sfn.Condition.stringEquals('$.Start.format', 'PDF'), pdfBranch)
        .when(sfn.Condition.stringEquals('$.Start.format', 'XLSX'), xlsxBranch)
        .when(sfn.Condition.stringEquals('$.Start.format', 'DOCX'), docxBranch)
        .otherwise(new sfn.Fail(this, 'Unsupported File Type')),
    );

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

    textractCallbackLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
      resources: [this.stateMachine.stateMachineArn],
    }));
  }
}
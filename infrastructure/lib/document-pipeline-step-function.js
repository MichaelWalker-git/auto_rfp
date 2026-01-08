"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentPipelineStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
const sfn = __importStar(require("aws-cdk-lib/aws-stepfunctions"));
const tasks = __importStar(require("aws-cdk-lib/aws-stepfunctions-tasks"));
const subscriptions = __importStar(require("aws-cdk-lib/aws-sns-subscriptions"));
const path = __importStar(require("path"));
const lambdaNode = __importStar(require("aws-cdk-lib/aws-lambda-nodejs"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
class DocumentPipelineStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { stage, documentsBucket, documentsTable, openSearchCollectionEndpoint, vpc, vpcSecurityGroup, } = props;
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
        const startTextractLambda = new lambdaNode.NodejsFunction(this, 'StartTextractJobLambda', {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../lambda/textract/start-textract.ts'),
            handler: 'handler',
            timeout: aws_cdk_lib_1.Duration.seconds(30),
            functionName: `${namePrefix}-StartTextractJob`,
            environment: {
                DB_TABLE_NAME: documentsTable.tableName,
                DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
                SNS_TOPIC_ARN: textractTopic.topicArn,
                TEXTRACT_ROLE_ARN: textractServiceRole.roleArn,
            },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        documentsTable.grantReadWriteData(startTextractLambda);
        documentsBucket.grantRead(startTextractLambda);
        startTextractLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['textract:StartDocumentTextDetection'],
            resources: ['*'],
        }));
        startTextractLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['iam:PassRole'],
            resources: [textractServiceRole.roleArn],
        }));
        // 3. Callback Handler Lambda
        const callbackHandlerLambda = new lambdaNode.NodejsFunction(this, 'TextractCallbackHandler', {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../lambda/textract/callback-handler.ts'),
            handler: 'handler',
            timeout: aws_cdk_lib_1.Duration.seconds(15),
            functionName: `${namePrefix}-TextractCallbackHandler`,
            environment: {
                DB_TABLE_NAME: documentsTable.tableName,
            },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        documentsTable.grantReadData(callbackHandlerLambda);
        callbackHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
            resources: ['*'],
        }));
        textractTopic.addSubscription(new subscriptions.LambdaSubscription(callbackHandlerLambda));
        // 4. Lambda 2 – Process Textract + Bedrock + AOSS
        const processResultLambda = new lambdaNode.NodejsFunction(this, 'ProcessTextractResultLambda', {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../lambda/textract/process-result.ts'),
            handler: 'handler',
            memorySize: 2048,
            timeout: aws_cdk_lib_1.Duration.minutes(5),
            functionName: `${namePrefix}-ProcessTextractResult`,
            vpc,
            securityGroups: [vpcSecurityGroup],
            environment: {
                DOCUMENTS_BUCKET: documentsBucket.bucketName,
                DOCUMENTS_TABLE_NAME: documentsTable.tableName,
                OPENSEARCH_ENDPOINT: openSearchCollectionEndpoint,
                REGION: this.region,
            },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        documentsTable.grantWriteData(processResultLambda);
        processResultLambda.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'));
        processResultLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['textract:GetDocumentTextDetection'],
            resources: ['*'],
        }));
        processResultLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['dynamodb:*'],
            resources: ['*'],
        }));
        processResultLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['s3:*'],
            resources: ['*'],
        }));
        processResultLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'aoss:APIAccessAll',
            ],
            resources: [
                'arn:aws:aoss:us-east-1:039885961427:collection/leb5aji6vthaxk7ft8pi',
            ],
        }));
        processResultLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel'],
            resources: [`arn:aws:bedrock:${this.region}::foundation-model/*`],
        }));
        processResultLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['aoss:APIAccess'],
            resources: ['*'],
        }));
        // 5. Step Functions Logging
        const sfnLogGroup = new logs.LogGroup(this, 'DocumentPipelineStateMachineLogs', {
            retention: logs.RetentionDays.ONE_WEEK,
        });
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
        const startTextractTask = new tasks.LambdaInvoke(this, 'Start Textract Job', {
            lambdaFunction: startTextractLambda,
            integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
            payload: sfn.TaskInput.fromObject({
                taskToken: sfn.JsonPath.taskToken,
                documentId: sfn.JsonPath.stringAt('$.documentId'),
            }),
            resultPath: '$.TextractJob',
        });
        const processResultTask = new tasks.LambdaInvoke(this, 'Process Results and Index', {
            lambdaFunction: processResultLambda,
            payload: sfn.TaskInput.fromObject({
                documentId: sfn.JsonPath.stringAt('$.TextractJob.documentId'),
                jobId: sfn.JsonPath.stringAt('$.TextractJob.jobId'),
                knowledgeBaseId: sfn.JsonPath.stringAt('$.TextractJob.knowledgeBaseId'),
            }),
            resultPath: sfn.JsonPath.DISCARD,
        });
        const definition = startTextractTask
            .next(processResultTask)
            .next(new sfn.Succeed(this, 'Pipeline Succeeded'));
        this.stateMachine = new sfn.StateMachine(this, 'DocumentProcessingStateMachine', {
            stateMachineName: `${namePrefix}-DocumentPipeline`,
            definitionBody: sfn.DefinitionBody.fromChainable(definition),
            timeout: aws_cdk_lib_1.Duration.minutes(30),
            logs: {
                destination: sfnLogGroup,
                level: sfn.LogLevel.ALL,
                includeExecutionData: true,
            },
        });
    }
}
exports.DocumentPipelineStack = DocumentPipelineStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZG9jdW1lbnQtcGlwZWxpbmUtc3RlcC1mdW5jdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImRvY3VtZW50LXBpcGVsaW5lLXN0ZXAtZnVuY3Rpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsNkNBQTBEO0FBSTFELCtEQUFpRDtBQUNqRCx5REFBMkM7QUFDM0MseURBQTJDO0FBRTNDLG1FQUFxRDtBQUNyRCwyRUFBNkQ7QUFDN0QsaUZBQW1FO0FBQ25FLDJDQUE2QjtBQUM3QiwwRUFBNEQ7QUFDNUQsMkRBQTZDO0FBVzdDLE1BQWEscUJBQXNCLFNBQVEsbUJBQUs7SUFHOUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFpQztRQUN6RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQ0osS0FBSyxFQUNMLGVBQWUsRUFDZixjQUFjLEVBQ2QsNEJBQTRCLEVBQzVCLEdBQUcsRUFDSCxnQkFBZ0IsR0FDakIsR0FBRyxLQUFLLENBQUM7UUFFVixNQUFNLFVBQVUsR0FBRyxXQUFXLEtBQUssRUFBRSxDQUFDO1FBRXRDLCtCQUErQjtRQUMvQixNQUFNLGFBQWEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFO1lBQ25FLFNBQVMsRUFBRSxHQUFHLFVBQVUsMEJBQTBCO1NBQ25ELENBQUMsQ0FBQztRQUVILE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUNwRSxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsd0JBQXdCLENBQUM7WUFDN0QsUUFBUSxFQUFFLEdBQUcsVUFBVSxzQkFBc0I7U0FDOUMsQ0FBQyxDQUFDO1FBQ0gsYUFBYSxDQUFDLFlBQVksQ0FBQyxtQkFBbUIs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QVc7Z0JBQ3hCLEtBQUssRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLEdBQUc7Z0JBQ3ZCLG9CQUFvQixFQUFFLElBQUk7YUFDM0I7U0FDRixDQUNGLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUFuUEQsc0RBbVBDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHVyYXRpb24sIFN0YWNrLCBTdGFja1Byb3BzIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHNucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIHNmbiBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucyc7XG5pbXBvcnQgKiBhcyB0YXNrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucy10YXNrcyc7XG5pbXBvcnQgKiBhcyBzdWJzY3JpcHRpb25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMtc3Vic2NyaXB0aW9ucyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgbGFtYmRhTm9kZSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcblxuaW50ZXJmYWNlIERvY3VtZW50UGlwZWxpbmVTdGFja1Byb3BzIGV4dGVuZHMgU3RhY2tQcm9wcyB7XG4gIHN0YWdlOiBzdHJpbmc7XG4gIGRvY3VtZW50c0J1Y2tldDogczMuSUJ1Y2tldDtcbiAgZG9jdW1lbnRzVGFibGU6IGR5bmFtb2RiLklUYWJsZTtcbiAgb3BlblNlYXJjaENvbGxlY3Rpb25FbmRwb2ludDogc3RyaW5nO1xuICB2cGM6IGVjMi5JVnBjO1xuICB2cGNTZWN1cml0eUdyb3VwOiBlYzIuSVNlY3VyaXR5R3JvdXA7XG59XG5cbmV4cG9ydCBjbGFzcyBEb2N1bWVudFBpcGVsaW5lU3RhY2sgZXh0ZW5kcyBTdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBzdGF0ZU1hY2hpbmU6IHNmbi5TdGF0ZU1hY2hpbmU7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IERvY3VtZW50UGlwZWxpbmVTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7XG4gICAgICBzdGFnZSxcbiAgICAgIGRvY3VtZW50c0J1Y2tldCxcbiAgICAgIGRvY3VtZW50c1RhYmxlLFxuICAgICAgb3BlblNlYXJjaENvbGxlY3Rpb25FbmRwb2ludCxcbiAgICAgIHZwYyxcbiAgICAgIHZwY1NlY3VyaXR5R3JvdXAsXG4gICAgfSA9IHByb3BzO1xuXG4gICAgY29uc3QgbmFtZVByZWZpeCA9IGBBdXRvUmZwLSR7c3RhZ2V9YDtcblxuICAgIC8vIDEuIFNOUyBUb3BpYyArIFRleHRyYWN0IHJvbGVcbiAgICBjb25zdCB0ZXh0cmFjdFRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnVGV4dHJhY3RDb21wbGV0aW9uVG9waWMnLCB7XG4gICAgICB0b3BpY05hbWU6IGAke25hbWVQcmVmaXh9LVRleHRyYWN0Q29tcGxldGlvblRvcGljYCxcbiAgICB9KTtcblxuICAgIGNvbnN0IHRleHRyYWN0U2VydmljZVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1RleHRyYWN0U2VydmljZVJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgndGV4dHJhY3QuYW1hem9uYXdzLmNvbScpLFxuICAgICAgcm9sZU5hbWU6IGAke25hbWVQcmVmaXh9LVRleHRyYWN0U2VydmljZVJvbGVgLFxuICAgIH0pO1xuICAgIHRleHRyYWN0VG9waWMuZ3JhbnRQdWJsaXNoKHRleHRyYWN0U2VydmljZVJvbGUpO1xuXG4gICAgLy8gMi4gTGFtYmRhIDEg4oCTIFN0YXJ0IFRleHRyYWN0IEpvYiAoY2FsbGJhY2sgcGF0dGVybiB0YXJnZXQpXG4gICAgY29uc3Qgc3RhcnRUZXh0cmFjdExhbWJkYSA9IG5ldyBsYW1iZGFOb2RlLk5vZGVqc0Z1bmN0aW9uKFxuICAgICAgdGhpcyxcbiAgICAgICdTdGFydFRleHRyYWN0Sm9iTGFtYmRhJyxcbiAgICAgIHtcbiAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vbGFtYmRhL3RleHRyYWN0L3N0YXJ0LXRleHRyYWN0LnRzJyksXG4gICAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgIGZ1bmN0aW9uTmFtZTogYCR7bmFtZVByZWZpeH0tU3RhcnRUZXh0cmFjdEpvYmAsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgREJfVEFCTEVfTkFNRTogZG9jdW1lbnRzVGFibGUudGFibGVOYW1lLFxuICAgICAgICAgIERPQ1VNRU5UU19CVUNLRVRfTkFNRTogZG9jdW1lbnRzQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgICAgU05TX1RPUElDX0FSTjogdGV4dHJhY3RUb3BpYy50b3BpY0FybixcbiAgICAgICAgICBURVhUUkFDVF9ST0xFX0FSTjogdGV4dHJhY3RTZXJ2aWNlUm9sZS5yb2xlQXJuLFxuICAgICAgICB9LFxuICAgICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIGRvY3VtZW50c1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShzdGFydFRleHRyYWN0TGFtYmRhKTtcbiAgICBkb2N1bWVudHNCdWNrZXQuZ3JhbnRSZWFkKHN0YXJ0VGV4dHJhY3RMYW1iZGEpO1xuICAgIHN0YXJ0VGV4dHJhY3RMYW1iZGEuYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbJ3RleHRyYWN0OlN0YXJ0RG9jdW1lbnRUZXh0RGV0ZWN0aW9uJ10sXG4gICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICB9KSxcbiAgICApO1xuICAgIHN0YXJ0VGV4dHJhY3RMYW1iZGEuYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbJ2lhbTpQYXNzUm9sZSddLFxuICAgICAgICByZXNvdXJjZXM6IFt0ZXh0cmFjdFNlcnZpY2VSb2xlLnJvbGVBcm5dLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vIDMuIENhbGxiYWNrIEhhbmRsZXIgTGFtYmRhXG4gICAgY29uc3QgY2FsbGJhY2tIYW5kbGVyTGFtYmRhID0gbmV3IGxhbWJkYU5vZGUuTm9kZWpzRnVuY3Rpb24oXG4gICAgICB0aGlzLFxuICAgICAgJ1RleHRyYWN0Q2FsbGJhY2tIYW5kbGVyJyxcbiAgICAgIHtcbiAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vbGFtYmRhL3RleHRyYWN0L2NhbGxiYWNrLWhhbmRsZXIudHMnKSxcbiAgICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxuICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDE1KSxcbiAgICAgICAgZnVuY3Rpb25OYW1lOiBgJHtuYW1lUHJlZml4fS1UZXh0cmFjdENhbGxiYWNrSGFuZGxlcmAsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgREJfVEFCTEVfTkFNRTogZG9jdW1lbnRzVGFibGUudGFibGVOYW1lLFxuICAgICAgICB9LFxuICAgICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIGRvY3VtZW50c1RhYmxlLmdyYW50UmVhZERhdGEoY2FsbGJhY2tIYW5kbGVyTGFtYmRhKTtcblxuICAgIGNhbGxiYWNrSGFuZGxlckxhbWJkYS5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnc3RhdGVzOlNlbmRUYXNrU3VjY2VzcycsICdzdGF0ZXM6U2VuZFRhc2tGYWlsdXJlJ10sXG4gICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgdGV4dHJhY3RUb3BpYy5hZGRTdWJzY3JpcHRpb24oXG4gICAgICBuZXcgc3Vic2NyaXB0aW9ucy5MYW1iZGFTdWJzY3JpcHRpb24oY2FsbGJhY2tIYW5kbGVyTGFtYmRhKSxcbiAgICApO1xuXG4gICAgLy8gNC4gTGFtYmRhIDIg4oCTIFByb2Nlc3MgVGV4dHJhY3QgKyBCZWRyb2NrICsgQU9TU1xuICAgIGNvbnN0IHByb2Nlc3NSZXN1bHRMYW1iZGEgPSBuZXcgbGFtYmRhTm9kZS5Ob2RlanNGdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICAnUHJvY2Vzc1RleHRyYWN0UmVzdWx0TGFtYmRhJyxcbiAgICAgIHtcbiAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vbGFtYmRhL3RleHRyYWN0L3Byb2Nlc3MtcmVzdWx0LnRzJyksXG4gICAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgICAgbWVtb3J5U2l6ZTogMjA0OCxcbiAgICAgICAgdGltZW91dDogRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgZnVuY3Rpb25OYW1lOiBgJHtuYW1lUHJlZml4fS1Qcm9jZXNzVGV4dHJhY3RSZXN1bHRgLFxuICAgICAgICB2cGMsXG4gICAgICAgIHNlY3VyaXR5R3JvdXBzOiBbdnBjU2VjdXJpdHlHcm91cF0sXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgRE9DVU1FTlRTX0JVQ0tFVDogZG9jdW1lbnRzQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgICAgRE9DVU1FTlRTX1RBQkxFX05BTUU6IGRvY3VtZW50c1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgICBPUEVOU0VBUkNIX0VORFBPSU5UOiBvcGVuU2VhcmNoQ29sbGVjdGlvbkVuZHBvaW50LFxuICAgICAgICAgIFJFR0lPTjogdGhpcy5yZWdpb24sXG4gICAgICAgIH0sXG4gICAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgZG9jdW1lbnRzVGFibGUuZ3JhbnRXcml0ZURhdGEocHJvY2Vzc1Jlc3VsdExhbWJkYSk7XG5cbiAgICBwcm9jZXNzUmVzdWx0TGFtYmRhLnJvbGU/LmFkZE1hbmFnZWRQb2xpY3koXG4gICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXG4gICAgICAgICdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZScsXG4gICAgICApLFxuICAgICk7XG5cbiAgICBwcm9jZXNzUmVzdWx0TGFtYmRhLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogWyd0ZXh0cmFjdDpHZXREb2N1bWVudFRleHREZXRlY3Rpb24nXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBwcm9jZXNzUmVzdWx0TGFtYmRhLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogWydkeW5hbW9kYjoqJ10sXG4gICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICB9KSxcbiAgICApXG5cbiAgICBwcm9jZXNzUmVzdWx0TGFtYmRhLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogWydzMzoqJ10sXG4gICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICB9KSxcbiAgICApXG5cbiAgICBwcm9jZXNzUmVzdWx0TGFtYmRhLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgJ2Fvc3M6QVBJQWNjZXNzQWxsJyxcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgJ2Fybjphd3M6YW9zczp1cy1lYXN0LTE6MDM5ODg1OTYxNDI3OmNvbGxlY3Rpb24vbGViNWFqaTZ2dGhheGs3ZnQ4cGknLFxuICAgICAgICBdLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHByb2Nlc3NSZXN1bHRMYW1iZGEuYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbJ2JlZHJvY2s6SW52b2tlTW9kZWwnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufTo6Zm91bmRhdGlvbi1tb2RlbC8qYF0sXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgcHJvY2Vzc1Jlc3VsdExhbWJkYS5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnYW9zczpBUElBY2Nlc3MnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyA1LiBTdGVwIEZ1bmN0aW9ucyBMb2dnaW5nXG4gICAgY29uc3Qgc2ZuTG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cChcbiAgICAgIHRoaXMsXG4gICAgICAnRG9jdW1lbnRQaXBlbGluZVN0YXRlTWFjaGluZUxvZ3MnLFxuICAgICAge1xuICAgICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIC8vIDYuIFN0YXRlIE1hY2hpbmUgZGVmaW5pdGlvbiAoTGFtYmRhIGNhbGxiYWNrIHBhdHRlcm4pXG5cbiAgICAvLyBJbnB1dCB0byBzdGF0ZSBtYWNoaW5lOlxuICAgIC8vICAgeyBcImRvY3VtZW50SWRcIjogXCIuLi5cIiwgXCJrbm93bGVkZ2VCYXNlSWRcIjogXCIuLi5cIiB9ICAoa2JJZCBvbmx5IHVzZWQgYnkgcHJvY2Vzcy1yZXN1bHQ7IHN0YXJ0LXRleHRyYWN0IGRlcml2ZXMgaXQgZnJvbSBTSyBpZiBuZWVkZWQpXG4gICAgLy9cbiAgICAvLyBTdGFydFRleHRyYWN0Sm9iIChXQUlUX0ZPUl9UQVNLX1RPS0VOKTpcbiAgICAvLyAgIC0gU0ZOIHBhc3NlcyB0YXNrVG9rZW4gKyBkb2N1bWVudElkXG4gICAgLy8gICAtIGxhbWJkYSBzdGFydHMgVGV4dHJhY3QsIHN0b3JlcyB0YXNrVG9rZW4gaW4gRHluYW1vXG4gICAgLy8gICAtIFNGTiB3YWl0cyB1bnRpbCBjYWxsYmFjay1oYW5kbGVyIGNhbGxzIFNlbmRUYXNrU3VjY2VzcyB3aXRoIHRoYXQgdG9rZW5cbiAgICAvL1xuICAgIC8vIGNhbGxiYWNrLWhhbmRsZXIgb3V0cHV0IChTZW5kVGFza1N1Y2Nlc3Mub3V0cHV0KSBpczpcbiAgICAvLyAgIHsgam9iSWQsIGRvY3VtZW50SWQsIGtub3dsZWRnZUJhc2VJZCwgc3RhdHVzIH1cbiAgICAvLyBzdG9yZWQgdW5kZXIgJC5UZXh0cmFjdEpvYlxuXG4gICAgY29uc3Qgc3RhcnRUZXh0cmFjdFRhc2sgPSBuZXcgdGFza3MuTGFtYmRhSW52b2tlKFxuICAgICAgdGhpcyxcbiAgICAgICdTdGFydCBUZXh0cmFjdCBKb2InLFxuICAgICAge1xuICAgICAgICBsYW1iZGFGdW5jdGlvbjogc3RhcnRUZXh0cmFjdExhbWJkYSxcbiAgICAgICAgaW50ZWdyYXRpb25QYXR0ZXJuOiBzZm4uSW50ZWdyYXRpb25QYXR0ZXJuLldBSVRfRk9SX1RBU0tfVE9LRU4sXG4gICAgICAgIHBheWxvYWQ6IHNmbi5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgICAgdGFza1Rva2VuOiBzZm4uSnNvblBhdGgudGFza1Rva2VuLFxuICAgICAgICAgIGRvY3VtZW50SWQ6IHNmbi5Kc29uUGF0aC5zdHJpbmdBdCgnJC5kb2N1bWVudElkJyksXG4gICAgICAgIH0pLFxuICAgICAgICByZXN1bHRQYXRoOiAnJC5UZXh0cmFjdEpvYicsXG4gICAgICB9LFxuICAgICk7XG5cbiAgICBjb25zdCBwcm9jZXNzUmVzdWx0VGFzayA9IG5ldyB0YXNrcy5MYW1iZGFJbnZva2UoXG4gICAgICB0aGlzLFxuICAgICAgJ1Byb2Nlc3MgUmVzdWx0cyBhbmQgSW5kZXgnLFxuICAgICAge1xuICAgICAgICBsYW1iZGFGdW5jdGlvbjogcHJvY2Vzc1Jlc3VsdExhbWJkYSxcbiAgICAgICAgcGF5bG9hZDogc2ZuLlRhc2tJbnB1dC5mcm9tT2JqZWN0KHtcbiAgICAgICAgICBkb2N1bWVudElkOiBzZm4uSnNvblBhdGguc3RyaW5nQXQoJyQuVGV4dHJhY3RKb2IuZG9jdW1lbnRJZCcpLFxuICAgICAgICAgIGpvYklkOiBzZm4uSnNvblBhdGguc3RyaW5nQXQoJyQuVGV4dHJhY3RKb2Iuam9iSWQnKSxcbiAgICAgICAgICBrbm93bGVkZ2VCYXNlSWQ6IHNmbi5Kc29uUGF0aC5zdHJpbmdBdChcbiAgICAgICAgICAgICckLlRleHRyYWN0Sm9iLmtub3dsZWRnZUJhc2VJZCcsXG4gICAgICAgICAgKSxcbiAgICAgICAgfSksXG4gICAgICAgIHJlc3VsdFBhdGg6IHNmbi5Kc29uUGF0aC5ESVNDQVJELFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgY29uc3QgZGVmaW5pdGlvbiA9IHN0YXJ0VGV4dHJhY3RUYXNrXG4gICAgICAubmV4dChwcm9jZXNzUmVzdWx0VGFzaylcbiAgICAgIC5uZXh0KG5ldyBzZm4uU3VjY2VlZCh0aGlzLCAnUGlwZWxpbmUgU3VjY2VlZGVkJykpO1xuXG4gICAgdGhpcy5zdGF0ZU1hY2hpbmUgPSBuZXcgc2ZuLlN0YXRlTWFjaGluZShcbiAgICAgIHRoaXMsXG4gICAgICAnRG9jdW1lbnRQcm9jZXNzaW5nU3RhdGVNYWNoaW5lJyxcbiAgICAgIHtcbiAgICAgICAgc3RhdGVNYWNoaW5lTmFtZTogYCR7bmFtZVByZWZpeH0tRG9jdW1lbnRQaXBlbGluZWAsXG4gICAgICAgIGRlZmluaXRpb25Cb2R5OiBzZm4uRGVmaW5pdGlvbkJvZHkuZnJvbUNoYWluYWJsZShkZWZpbml0aW9uKSxcbiAgICAgICAgdGltZW91dDogRHVyYXRpb24ubWludXRlcygzMCksXG4gICAgICAgIGxvZ3M6IHtcbiAgICAgICAgICBkZXN0aW5hdGlvbjogc2ZuTG9nR3JvdXAsXG4gICAgICAgICAgbGV2ZWw6IHNmbi5Mb2dMZXZlbC5BTEwsXG4gICAgICAgICAgaW5jbHVkZUV4ZWN1dGlvbkRhdGE6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICk7XG4gIH1cbn1cbiJdfQ==
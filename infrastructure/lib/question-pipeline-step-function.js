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
exports.QuestionExtractionPipelineStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const lambdaNode = __importStar(require("aws-cdk-lib/aws-lambda-nodejs"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
const subs = __importStar(require("aws-cdk-lib/aws-sns-subscriptions"));
const sfn = __importStar(require("aws-cdk-lib/aws-stepfunctions"));
const tasks = __importStar(require("aws-cdk-lib/aws-stepfunctions-tasks"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const path = __importStar(require("path"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
class QuestionExtractionPipelineStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { stage, documentsBucket, mainTable } = props;
        const prefix = `AutoRfp-${stage}-Question`;
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
        const startTextractLambda = new lambdaNode.NodejsFunction(this, 'StartTextractLambda', {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../lambda/question-pipeline/start-question-textract.ts'),
            handler: 'handler',
            timeout: aws_cdk_lib_1.Duration.seconds(30),
            environment: {
                DB_TABLE_NAME: mainTable.tableName,
                DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
                TEXTRACT_ROLE_ARN: textractRole.roleArn,
                TEXTRACT_SNS_TOPIC_ARN: textractTopic.topicArn,
            },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        documentsBucket.grantRead(startTextractLambda);
        mainTable.grantReadWriteData(startTextractLambda);
        startTextractLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['textract:StartDocumentTextDetection'],
            resources: ['*'],
        }));
        startTextractLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['iam:PassRole'],
            resources: [textractRole.roleArn],
        }));
        //
        // Callback Lambda (Textract + StepFunction token)
        //
        const callbackLambda = new lambdaNode.NodejsFunction(this, 'TextractCallbackLambda', {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../lambda/question-pipeline/textract-question-callback.ts'),
            handler: 'handler',
            timeout: aws_cdk_lib_1.Duration.seconds(30),
            environment: {
                DB_TABLE_NAME: mainTable.tableName,
            },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        callbackLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
            resources: ['*'],
        }));
        mainTable.grantReadWriteData(callbackLambda);
        textractTopic.addSubscription(new subs.LambdaSubscription(callbackLambda));
        //
        // process-question-file Lambda
        //
        const processResultLambda = new lambdaNode.NodejsFunction(this, 'ProcessQuestionFileLambda', {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../lambda/question-pipeline/process-question-file.ts'),
            handler: 'handler',
            timeout: aws_cdk_lib_1.Duration.minutes(3),
            environment: {
                DB_TABLE_NAME: mainTable.tableName,
                DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
                REGION: this.region,
            },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        documentsBucket.grantReadWrite(processResultLambda);
        mainTable.grantReadWriteData(processResultLambda);
        processResultLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['textract:GetDocumentTextDetection'],
            resources: ['*'],
        }));
        processResultLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel'],
            resources: [`*`],
        }));
        //
        // extract-questions Lambda
        //
        const extractQuestionsLambda = new lambdaNode.NodejsFunction(this, 'ExtractQuestionsLambda', {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(__dirname, '../lambda/question-pipeline/extract-questions.ts'),
            handler: 'handler',
            timeout: aws_cdk_lib_1.Duration.minutes(2),
            environment: {
                DB_TABLE_NAME: mainTable.tableName,
                DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
                BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
                BEDROCK_REGION: 'us-east-1',
            },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        documentsBucket.grantRead(extractQuestionsLambda);
        mainTable.grantReadWriteData(extractQuestionsLambda);
        extractQuestionsLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel'],
            resources: [`*`],
        }));
        const startTextract = new tasks.LambdaInvoke(this, 'Start Textract', {
            lambdaFunction: startTextractLambda,
            integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
            payload: sfn.TaskInput.fromObject({
                taskToken: sfn.JsonPath.taskToken,
                questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
                projectId: sfn.JsonPath.stringAt('$.projectId'),
            }),
            resultPath: '$.textract',
        });
        const processResult = new tasks.LambdaInvoke(this, 'Process Textract Result', {
            lambdaFunction: processResultLambda,
            payload: sfn.TaskInput.fromObject({
                questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
                projectId: sfn.JsonPath.stringAt('$.projectId'),
                jobId: sfn.JsonPath.stringAt('$.textract.jobId'),
            }),
            resultPath: '$.process',
            payloadResponseOnly: true,
        });
        const extractQuestions = new tasks.LambdaInvoke(this, 'Extract Questions from Text', {
            lambdaFunction: extractQuestionsLambda,
            payload: sfn.TaskInput.fromObject({
                questionFileId: sfn.JsonPath.stringAt('$.questionFileId'),
                projectId: sfn.JsonPath.stringAt('$.projectId'),
                textFileKey: sfn.JsonPath.stringAt('$.process.textFileKey'),
            }),
            resultPath: sfn.JsonPath.DISCARD,
        });
        const definition = startTextract
            .next(processResult)
            .next(extractQuestions)
            .next(new sfn.Succeed(this, 'Done'));
        this.stateMachine = new sfn.StateMachine(this, 'QuestionExtractionStateMachine', {
            stateMachineName: `${prefix}-Pipeline`,
            definitionBody: sfn.DefinitionBody.fromChainable(definition),
            timeout: aws_cdk_lib_1.Duration.minutes(30),
        });
    }
}
exports.QuestionExtractionPipelineStack = QuestionExtractionPipelineStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlc3Rpb24tcGlwZWxpbmUtc3RlcC1mdW5jdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInF1ZXN0aW9uLXBpcGVsaW5lLXN0ZXAtZnVuY3Rpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsNkNBQTBEO0FBSTFELDBFQUE0RDtBQUM1RCwrREFBaUQ7QUFDakQseURBQTJDO0FBQzNDLHdFQUEwRDtBQUMxRCxtRUFBcUQ7QUFDckQsMkVBQTZEO0FBQzdELHlEQUEyQztBQUMzQywyQ0FBNkI7QUFDN0IsMkRBQTZDO0FBUTdDLE1BQWEsK0JBQWdDLFNBQVEsbUJBQUs7SUFHeEQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFZO1FBQ3BELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUNwRCxNQUFNLE1BQU0sR0FBRyxXQUFXLEtBQUssV0FBVyxDQUFDO1FBRTNDLEVBQUU7UUFDRiwrREFBK0Q7UUFDL0Qsc0JBQXNCO1FBQ3RCLCtEQUErRDtRQUMvRCxFQUFFO1FBQ0YsTUFBTSxhQUFhLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSx5QkFBeUIsRUFBRTtZQUNuRSxTQUFTLEVBQUUsR0FBRyxNQUFNLHFCQUFxQjtTQUMxQyxDQUFDLENBQUM7UUFFSCxFQUFFO1FBQ0YsZ0JBQWdCO1FBQ2hCLEVBQUU7UUFDRixNQUFNLFlBQVksR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQzdELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyx3QkFBd0IsQ0FBQztTQUM5RCxDQUFDLENBQUM7UUFFSCxhQUFhLENBQUMsWUFBWSxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBRXpDLEVBQUU7UUFDRiwrREFBK0Q7UUFDL0QsV0FBVztRQUNYLCtEQUErRDtRQUMvRCxFQUFFO1FBRUYsRUFBRTtRQUNGLHVCQUF1QjtRQUN2QixFQUFFO1FBQ0YsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLFVBQVUsQ0FBQyxjQUFjLENBQ3ZELElBQUksRUFDSixxQkFBcUIsRUFDckI7WUFDRSxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ25DLEtBQUssRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSx3REFBd0QsQ0FBQztZQUNyRixPQUFPLEVBQUUsU0FBUztZQUNsQixPQUFPLEVBQUUsc0JBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQzdCLFdBQVcsRUFBRTtnQkFDWCxhQUFhLEVBQUUsU0FBUyxDQUFDLFNBQVM7Z0JBQ2xDLHFCQUFxQixFQUFFLGVBQWUsQ0FBQyxVQUFVO2dCQUNqRCxpQkFBaUIsRUFBRSxZQUFZLENBQUMsT0FBTztnQkFDdkMsc0JBQXNCLEVBQUUsYUFBYSxDQUFDLFFBQVE7YUFDL0M7WUFDRCxZQUFZLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRO1NBQzFDLENBQ0YsQ0FBQztRQUNGLGVBQWUsQ0FBQyxTQUFTLENBQUMsbUJBQW1CLENBQUMsQ0FBQztRQUMvQyxTQUFTLENBQUMsa0JBQWtCLENBQUMsbUJBQW1CLENBQUMsQ0FBQztRQUVsRCxtQkFBbUIsQ0FBQyxlQUFlLENBQ2pDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUN0QixPQUFPLEVBQUUsQ0FBQyxxQ0FBcUMsQ0FBQztZQUNoRCxTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUM7U0FDakIsQ0FBQyxDQUNILENBQUM7UUFFRixtQkFBbUIsQ0FBQyxlQUFlLENBQ2pDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUN0QixPQUFPLEVBQUUsQ0FBQyxjQUFjLENBQUM7WUFDekIsU0FBUyxFQUFFLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQztTQUNsQyxDQUFDLENBQ0gsQ0FBQztRQUVGLEVBQUU7UUFDRixrREFBa0Q7UUFDbEQsRUFBRTtRQUNGLE1BQU0sY0FBYyxHQUFHLElBQUksVUFBVSxDQUFDLGNBQWMsQ0FDbEQsSUFBSSxFQUNKLHdCQUF3QixFQUN4QjtZQUNFLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLFdBQVc7WUFDbkMsS0FBSyxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLDJEQUEyRCxDQUFDO1lBQ3hGLE9BQU8sRUFBRSxTQUFTO1lBQ2xCLE9BQU8sRUFBRSxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDN0IsV0FBVyxFQUFFO2dCQUNYLGFBQWEsRUFBRSxTQUFTLENBQUMsU0FBUzthQUNuQztZQUNELFlBQVksRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVE7U0FDMUMsQ0FDRixDQUFDO1FBRUYsY0FBYyxDQUFDLGVBQWUsQ0FDNUIsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQ3RCLE9BQU8sRUFBRSxDQUFDLHdCQUF3QixFQUFFLHdCQUF3QixDQUFDO1lBQzdELFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQztTQUNqQixDQUFDLENBQ0gsQ0FBQztRQUVGLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUU3QyxhQUFhLENBQUMsZUFBZSxDQUMzQixJQUFJLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxjQUFjLENBQUMsQ0FDNUMsQ0FBQztRQUVGLEVBQUU7UUFDRiwrQkFBK0I7UUFDL0IsRUFBRTtRQUNGLE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxVQUFVLENBQUMsY0FBYyxDQUN2RCxJQUFJLEVBQ0osMkJBQTJCLEVBQzNCO1lBQ0UsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVztZQUNuQyxLQUFLLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsc0RBQXNELENBQUM7WUFDbkYsT0FBTyxFQUFFLFNBQVM7WUFDbEIsT0FBTyxFQUFFLHNCQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztZQUM1QixXQUFXLEVBQUU7Z0JBQ1gsYUFBYSxFQUFFLFNBQVMsQ0FBQyxTQUFTO2dCQUNsQyxxQkFBcUIsRUFBRSxlQUFlLENBQUMsVUFBVTtnQkFDakQsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNO2FBQ3BCO1lBQ0QsWUFBWSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUTtTQUMxQyxDQUNGLENBQUM7UUFDRixlQUFlLENBQUMsY0FBYyxDQUFDLG1CQUFtQixDQUFDLENBQUM7UUFDcEQsU0FBUyxDQUFDLGtCQUFrQixDQUFDLG1CQUFtQixDQUFDLENBQUM7UUFDbEQsbUJBQW1CLENBQUMsZUFBZSxDQUNqQyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDdEIsT0FBTyxFQUFFLENBQUMsbUNBQW1DLENBQUM7WUFDOUMsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO1NBQ2pCLENBQUMsQ0FDSCxDQUFDO1FBQ0YsbUJBQW1CLENBQUMsZUFBZSxDQUNqQyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDdEIsT0FBTyxFQUFFLENBQUMscUJBQXFCLENBQUM7WUFDaEMsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO1NBQ2pCLENBQUMsQ0FDSCxDQUFDO1FBRUYsRUFBRTtRQUNGLDJCQUEyQjtRQUMzQixFQUFFO1FBQ0YsTUFBTSxzQkFBc0IsR0FBRyxJQUFJLFVBQVUsQ0FBQyxjQUFjLENBQzFELElBQUksRUFDSix3QkFBd0IsRUFDeEI7WUFDRSxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ25DLEtBQUssRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxrREFBa0QsQ0FBQztZQUMvRSxPQUFPLEVBQUUsU0FBUztZQUNsQixPQUFPLEVBQUUsc0JBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1lBQzVCLFdBQVcsRUFBRTtnQkFDWCxhQUFhLEVBQUUsU0FBUyxDQUFDLFNBQVM7Z0JBQ2xDLHFCQUFxQixFQUFFLGVBQWUsQ0FBQyxVQUFVO2dCQUNqRCxnQkFBZ0IsRUFBRSx3Q0FBd0M7Z0JBQzFELGNBQWMsRUFBRSxXQUFXO2FBQzVCO1lBQ0QsWUFBWSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUTtTQUMxQyxDQUNGLENBQUM7UUFDRixlQUFlLENBQUMsU0FBUyxDQUFDLHNCQUFzQixDQUFDLENBQUM7UUFDbEQsU0FBUyxDQUFDLGtCQUFrQixDQUFDLHNCQUFzQixDQUFDLENBQUM7UUFDckQsc0JBQXNCLENBQUMsZUFBZSxDQUNwQyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDdEIsT0FBTyxFQUFFLENBQUMscUJBQXFCLENBQUM7WUFDaEMsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO1NBQ2pCLENBQUMsQ0FDSCxDQUFBO1FBR0QsTUFBTSxhQUFhLEdBQUcsSUFBSSxLQUFLLENBQUMsWUFBWSxDQUMxQyxJQUFJLEVBQ0osZ0JBQWdCLEVBQ2hCO1lBQ0UsY0FBYyxFQUFFLG1CQUFtQjtZQUNuQyxrQkFBa0IsRUFBRSxHQUFHLENBQUMsa0JBQWtCLENBQUMsbUJBQW1CO1lBQzlELE9BQU8sRUFBRSxHQUFHLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQztnQkFDaEMsU0FBUyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsU0FBUztnQkFDakMsY0FBYyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLGtCQUFrQixDQUFDO2dCQUN6RCxTQUFTLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDO2FBQ2hELENBQUM7WUFDRixVQUFVLEVBQUUsWUFBWTtTQUN6QixDQUNGLENBQUM7UUFFRixNQUFNLGFBQWEsR0FBRyxJQUFJLEtBQUssQ0FBQyxZQUFZLENBQzFDLElBQUksRUFDSix5QkFBeUIsRUFDekI7WUFDRSxjQUFjLEVBQUUsbUJBQW1CO1lBQ25DLE9BQU8sRUFBRSxHQUFHLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQztnQkFDaEMsY0FBYyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLGtCQUFrQixDQUFDO2dCQUN6RCxTQUFTLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDO2dCQUMvQyxLQUFLLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsa0JBQWtCLENBQUM7YUFDakQsQ0FBQztZQUNGLFVBQVUsRUFBRSxXQUFXO1lBQ3ZCLG1CQUFtQixFQUFFLElBQUk7U0FDMUIsQ0FDRixDQUFDO1FBRUYsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLEtBQUssQ0FBQyxZQUFZLENBQzdDLElBQUksRUFDSiw2QkFBNkIsRUFDN0I7WUFDRSxjQUFjLEVBQUUsc0JBQXNCO1lBQ3RDLE9BQU8sRUFBRSxHQUFHLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQztnQkFDaEMsY0FBYyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLGtCQUFrQixDQUFDO2dCQUN6RCxTQUFTLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDO2dCQUMvQyxXQUFXLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsdUJBQXVCLENBQUM7YUFDNUQsQ0FBQztZQUNGLFVBQVUsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU87U0FDakMsQ0FDRixDQUFDO1FBRUYsTUFBTSxVQUFVLEdBQUcsYUFBYTthQUM3QixJQUFJLENBQUMsYUFBYSxDQUFDO2FBQ25CLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQzthQUN0QixJQUFJLENBQUMsSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDO1FBR3ZDLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxHQUFHLENBQUMsWUFBWSxDQUN0QyxJQUFJLEVBQ0osZ0NBQWdDLEVBQ2hDO1lBQ0UsZ0JBQWdCLEVBQUUsR0FBRyxNQUFNLFdBQVc7WUFDdEMsY0FBYyxFQUFFLEdBQUcsQ0FBQyxjQUFjLENBQUMsYUFBYSxDQUFDLFVBQVUsQ0FBQztZQUM1RCxPQUFPLEVBQUUsc0JBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1NBQzlCLENBQ0YsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQWpPRCwwRUFpT0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEdXJhdGlvbiwgU3RhY2ssIFN0YWNrUHJvcHMgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgbGFtYmRhTm9kZSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5pbXBvcnQgKiBhcyBzdWJzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMtc3Vic2NyaXB0aW9ucyc7XG5pbXBvcnQgKiBhcyBzZm4gZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMnO1xuaW1wb3J0ICogYXMgdGFza3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMtdGFza3MnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuXG5pbnRlcmZhY2UgUHJvcHMgZXh0ZW5kcyBTdGFja1Byb3BzIHtcbiAgc3RhZ2U6IHN0cmluZztcbiAgZG9jdW1lbnRzQnVja2V0OiBzMy5JQnVja2V0O1xuICBtYWluVGFibGU6IGR5bmFtb2RiLklUYWJsZTtcbn1cblxuZXhwb3J0IGNsYXNzIFF1ZXN0aW9uRXh0cmFjdGlvblBpcGVsaW5lU3RhY2sgZXh0ZW5kcyBTdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBzdGF0ZU1hY2hpbmU6IHNmbi5TdGF0ZU1hY2hpbmU7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IFByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IHN0YWdlLCBkb2N1bWVudHNCdWNrZXQsIG1haW5UYWJsZSB9ID0gcHJvcHM7XG4gICAgY29uc3QgcHJlZml4ID0gYEF1dG9SZnAtJHtzdGFnZX0tUXVlc3Rpb25gO1xuXG4gICAgLy9cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyAgU05TIFRvcGljcyAoRklYRUQpXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy9cbiAgICBjb25zdCB0ZXh0cmFjdFRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnVGV4dHJhY3RDb21wbGV0aW9uVG9waWMnLCB7XG4gICAgICB0b3BpY05hbWU6IGAke3ByZWZpeH0tVGV4dHJhY3RDb21wbGV0aW9uYCxcbiAgICB9KTtcblxuICAgIC8vXG4gICAgLy8gVGV4dHJhY3QgUm9sZVxuICAgIC8vXG4gICAgY29uc3QgdGV4dHJhY3RSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdUZXh0cmFjdFNlcnZpY2VSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ3RleHRyYWN0LmFtYXpvbmF3cy5jb20nKSxcbiAgICB9KTtcblxuICAgIHRleHRyYWN0VG9waWMuZ3JhbnRQdWJsaXNoKHRleHRyYWN0Um9sZSk7XG5cbiAgICAvL1xuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vICBMYW1iZGFzXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy9cblxuICAgIC8vXG4gICAgLy8gU3RhcnRUZXh0cmFjdCBMYW1iZGFcbiAgICAvL1xuICAgIGNvbnN0IHN0YXJ0VGV4dHJhY3RMYW1iZGEgPSBuZXcgbGFtYmRhTm9kZS5Ob2RlanNGdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICAnU3RhcnRUZXh0cmFjdExhbWJkYScsXG4gICAgICB7XG4gICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2xhbWJkYS9xdWVzdGlvbi1waXBlbGluZS9zdGFydC1xdWVzdGlvbi10ZXh0cmFjdC50cycpLFxuICAgICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIERCX1RBQkxFX05BTUU6IG1haW5UYWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgRE9DVU1FTlRTX0JVQ0tFVF9OQU1FOiBkb2N1bWVudHNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgICBURVhUUkFDVF9ST0xFX0FSTjogdGV4dHJhY3RSb2xlLnJvbGVBcm4sXG4gICAgICAgICAgVEVYVFJBQ1RfU05TX1RPUElDX0FSTjogdGV4dHJhY3RUb3BpYy50b3BpY0FybixcbiAgICAgICAgfSxcbiAgICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICB9XG4gICAgKTtcbiAgICBkb2N1bWVudHNCdWNrZXQuZ3JhbnRSZWFkKHN0YXJ0VGV4dHJhY3RMYW1iZGEpO1xuICAgIG1haW5UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoc3RhcnRUZXh0cmFjdExhbWJkYSk7XG5cbiAgICBzdGFydFRleHRyYWN0TGFtYmRhLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogWyd0ZXh0cmFjdDpTdGFydERvY3VtZW50VGV4dERldGVjdGlvbiddLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgc3RhcnRUZXh0cmFjdExhbWJkYS5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnaWFtOlBhc3NSb2xlJ10sXG4gICAgICAgIHJlc291cmNlczogW3RleHRyYWN0Um9sZS5yb2xlQXJuXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vXG4gICAgLy8gQ2FsbGJhY2sgTGFtYmRhIChUZXh0cmFjdCArIFN0ZXBGdW5jdGlvbiB0b2tlbilcbiAgICAvL1xuICAgIGNvbnN0IGNhbGxiYWNrTGFtYmRhID0gbmV3IGxhbWJkYU5vZGUuTm9kZWpzRnVuY3Rpb24oXG4gICAgICB0aGlzLFxuICAgICAgJ1RleHRyYWN0Q2FsbGJhY2tMYW1iZGEnLFxuICAgICAge1xuICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9sYW1iZGEvcXVlc3Rpb24tcGlwZWxpbmUvdGV4dHJhY3QtcXVlc3Rpb24tY2FsbGJhY2sudHMnKSxcbiAgICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxuICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBEQl9UQUJMRV9OQU1FOiBtYWluVGFibGUudGFibGVOYW1lLFxuICAgICAgICB9LFxuICAgICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgY2FsbGJhY2tMYW1iZGEuYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbJ3N0YXRlczpTZW5kVGFza1N1Y2Nlc3MnLCAnc3RhdGVzOlNlbmRUYXNrRmFpbHVyZSddLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgbWFpblRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShjYWxsYmFja0xhbWJkYSk7XG5cbiAgICB0ZXh0cmFjdFRvcGljLmFkZFN1YnNjcmlwdGlvbihcbiAgICAgIG5ldyBzdWJzLkxhbWJkYVN1YnNjcmlwdGlvbihjYWxsYmFja0xhbWJkYSlcbiAgICApO1xuXG4gICAgLy9cbiAgICAvLyBwcm9jZXNzLXF1ZXN0aW9uLWZpbGUgTGFtYmRhXG4gICAgLy9cbiAgICBjb25zdCBwcm9jZXNzUmVzdWx0TGFtYmRhID0gbmV3IGxhbWJkYU5vZGUuTm9kZWpzRnVuY3Rpb24oXG4gICAgICB0aGlzLFxuICAgICAgJ1Byb2Nlc3NRdWVzdGlvbkZpbGVMYW1iZGEnLFxuICAgICAge1xuICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9sYW1iZGEvcXVlc3Rpb24tcGlwZWxpbmUvcHJvY2Vzcy1xdWVzdGlvbi1maWxlLnRzJyksXG4gICAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgICAgdGltZW91dDogRHVyYXRpb24ubWludXRlcygzKSxcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBEQl9UQUJMRV9OQU1FOiBtYWluVGFibGUudGFibGVOYW1lLFxuICAgICAgICAgIERPQ1VNRU5UU19CVUNLRVRfTkFNRTogZG9jdW1lbnRzQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgICAgUkVHSU9OOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgfSxcbiAgICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICB9XG4gICAgKTtcbiAgICBkb2N1bWVudHNCdWNrZXQuZ3JhbnRSZWFkV3JpdGUocHJvY2Vzc1Jlc3VsdExhbWJkYSk7XG4gICAgbWFpblRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShwcm9jZXNzUmVzdWx0TGFtYmRhKTtcbiAgICBwcm9jZXNzUmVzdWx0TGFtYmRhLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogWyd0ZXh0cmFjdDpHZXREb2N1bWVudFRleHREZXRlY3Rpb24nXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgIH0pLFxuICAgICk7XG4gICAgcHJvY2Vzc1Jlc3VsdExhbWJkYS5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnYmVkcm9jazpJbnZva2VNb2RlbCddLFxuICAgICAgICByZXNvdXJjZXM6IFtgKmBdLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIC8vXG4gICAgLy8gZXh0cmFjdC1xdWVzdGlvbnMgTGFtYmRhXG4gICAgLy9cbiAgICBjb25zdCBleHRyYWN0UXVlc3Rpb25zTGFtYmRhID0gbmV3IGxhbWJkYU5vZGUuTm9kZWpzRnVuY3Rpb24oXG4gICAgICB0aGlzLFxuICAgICAgJ0V4dHJhY3RRdWVzdGlvbnNMYW1iZGEnLFxuICAgICAge1xuICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9sYW1iZGEvcXVlc3Rpb24tcGlwZWxpbmUvZXh0cmFjdC1xdWVzdGlvbnMudHMnKSxcbiAgICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxuICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5taW51dGVzKDIpLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIERCX1RBQkxFX05BTUU6IG1haW5UYWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgRE9DVU1FTlRTX0JVQ0tFVF9OQU1FOiBkb2N1bWVudHNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgICBCRURST0NLX01PREVMX0lEOiAnYW50aHJvcGljLmNsYXVkZS0zLWhhaWt1LTIwMjQwMzA3LXYxOjAnLFxuICAgICAgICAgIEJFRFJPQ0tfUkVHSU9OOiAndXMtZWFzdC0xJyxcbiAgICAgICAgfSxcbiAgICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICB9XG4gICAgKTtcbiAgICBkb2N1bWVudHNCdWNrZXQuZ3JhbnRSZWFkKGV4dHJhY3RRdWVzdGlvbnNMYW1iZGEpO1xuICAgIG1haW5UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoZXh0cmFjdFF1ZXN0aW9uc0xhbWJkYSk7XG4gICAgZXh0cmFjdFF1ZXN0aW9uc0xhbWJkYS5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnYmVkcm9jazpJbnZva2VNb2RlbCddLFxuICAgICAgICByZXNvdXJjZXM6IFtgKmBdLFxuICAgICAgfSksXG4gICAgKVxuXG5cbiAgICBjb25zdCBzdGFydFRleHRyYWN0ID0gbmV3IHRhc2tzLkxhbWJkYUludm9rZShcbiAgICAgIHRoaXMsXG4gICAgICAnU3RhcnQgVGV4dHJhY3QnLFxuICAgICAge1xuICAgICAgICBsYW1iZGFGdW5jdGlvbjogc3RhcnRUZXh0cmFjdExhbWJkYSxcbiAgICAgICAgaW50ZWdyYXRpb25QYXR0ZXJuOiBzZm4uSW50ZWdyYXRpb25QYXR0ZXJuLldBSVRfRk9SX1RBU0tfVE9LRU4sXG4gICAgICAgIHBheWxvYWQ6IHNmbi5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgICAgdGFza1Rva2VuOiBzZm4uSnNvblBhdGgudGFza1Rva2VuLFxuICAgICAgICAgIHF1ZXN0aW9uRmlsZUlkOiBzZm4uSnNvblBhdGguc3RyaW5nQXQoJyQucXVlc3Rpb25GaWxlSWQnKSxcbiAgICAgICAgICBwcm9qZWN0SWQ6IHNmbi5Kc29uUGF0aC5zdHJpbmdBdCgnJC5wcm9qZWN0SWQnKSxcbiAgICAgICAgfSksXG4gICAgICAgIHJlc3VsdFBhdGg6ICckLnRleHRyYWN0JyxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgY29uc3QgcHJvY2Vzc1Jlc3VsdCA9IG5ldyB0YXNrcy5MYW1iZGFJbnZva2UoXG4gICAgICB0aGlzLFxuICAgICAgJ1Byb2Nlc3MgVGV4dHJhY3QgUmVzdWx0JyxcbiAgICAgIHtcbiAgICAgICAgbGFtYmRhRnVuY3Rpb246IHByb2Nlc3NSZXN1bHRMYW1iZGEsXG4gICAgICAgIHBheWxvYWQ6IHNmbi5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgICAgcXVlc3Rpb25GaWxlSWQ6IHNmbi5Kc29uUGF0aC5zdHJpbmdBdCgnJC5xdWVzdGlvbkZpbGVJZCcpLFxuICAgICAgICAgIHByb2plY3RJZDogc2ZuLkpzb25QYXRoLnN0cmluZ0F0KCckLnByb2plY3RJZCcpLFxuICAgICAgICAgIGpvYklkOiBzZm4uSnNvblBhdGguc3RyaW5nQXQoJyQudGV4dHJhY3Quam9iSWQnKSxcbiAgICAgICAgfSksXG4gICAgICAgIHJlc3VsdFBhdGg6ICckLnByb2Nlc3MnLFxuICAgICAgICBwYXlsb2FkUmVzcG9uc2VPbmx5OiB0cnVlLFxuICAgICAgfVxuICAgICk7XG5cbiAgICBjb25zdCBleHRyYWN0UXVlc3Rpb25zID0gbmV3IHRhc2tzLkxhbWJkYUludm9rZShcbiAgICAgIHRoaXMsXG4gICAgICAnRXh0cmFjdCBRdWVzdGlvbnMgZnJvbSBUZXh0JyxcbiAgICAgIHtcbiAgICAgICAgbGFtYmRhRnVuY3Rpb246IGV4dHJhY3RRdWVzdGlvbnNMYW1iZGEsXG4gICAgICAgIHBheWxvYWQ6IHNmbi5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgICAgcXVlc3Rpb25GaWxlSWQ6IHNmbi5Kc29uUGF0aC5zdHJpbmdBdCgnJC5xdWVzdGlvbkZpbGVJZCcpLFxuICAgICAgICAgIHByb2plY3RJZDogc2ZuLkpzb25QYXRoLnN0cmluZ0F0KCckLnByb2plY3RJZCcpLFxuICAgICAgICAgIHRleHRGaWxlS2V5OiBzZm4uSnNvblBhdGguc3RyaW5nQXQoJyQucHJvY2Vzcy50ZXh0RmlsZUtleScpLFxuICAgICAgICB9KSxcbiAgICAgICAgcmVzdWx0UGF0aDogc2ZuLkpzb25QYXRoLkRJU0NBUkQsXG4gICAgICB9XG4gICAgKTtcblxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBzdGFydFRleHRyYWN0XG4gICAgICAubmV4dChwcm9jZXNzUmVzdWx0KVxuICAgICAgLm5leHQoZXh0cmFjdFF1ZXN0aW9ucylcbiAgICAgIC5uZXh0KG5ldyBzZm4uU3VjY2VlZCh0aGlzLCAnRG9uZScpKTtcblxuXG4gICAgdGhpcy5zdGF0ZU1hY2hpbmUgPSBuZXcgc2ZuLlN0YXRlTWFjaGluZShcbiAgICAgIHRoaXMsXG4gICAgICAnUXVlc3Rpb25FeHRyYWN0aW9uU3RhdGVNYWNoaW5lJyxcbiAgICAgIHtcbiAgICAgICAgc3RhdGVNYWNoaW5lTmFtZTogYCR7cHJlZml4fS1QaXBlbGluZWAsXG4gICAgICAgIGRlZmluaXRpb25Cb2R5OiBzZm4uRGVmaW5pdGlvbkJvZHkuZnJvbUNoYWluYWJsZShkZWZpbml0aW9uKSxcbiAgICAgICAgdGltZW91dDogRHVyYXRpb24ubWludXRlcygzMCksXG4gICAgICB9XG4gICAgKTtcbiAgfVxufVxuIl19
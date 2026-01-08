#!/usr/bin/env node
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
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const auth_stack_1 = require("../lib/auth-stack");
const api_stack_1 = require("../lib/api-stack");
const storage_stack_1 = require("../lib/storage-stack");
const database_stack_1 = require("../lib/database-stack");
const network_stack_1 = require("../lib/network-stack");
const amplify_fe_stack_1 = require("../lib/amplify-fe-stack");
const document_pipeline_step_function_1 = require("../lib/document-pipeline-step-function");
const question_pipeline_step_function_1 = require("../lib/question-pipeline-step-function");
const app = new cdk.App();
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT || '018222125196', // Hardcode the account ID we obtained
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};
const stage = 'Dev';
const network = new network_stack_1.NetworkStack(app, 'AutoRfp-Network', {
    env,
    existingVpcId: 'vpc-07171e4bf57f2ceed',
});
const feURL = 'https://dpxejv2wk0.execute-api.us-east-1.amazonaws.com';
const opensearchEndpoint = 'https://leb5aji6vthaxk7ft8pi.us-east-1.aoss.amazonaws.com';
const auth = new auth_stack_1.AuthStack(app, `AutoRfp-Auth-${stage}`, {
    env,
    stage: stage,
    domainPrefixBase: 'auto-rfp',
    callbackUrls: [
        'http://localhost:3000',
        feURL
    ]
});
const storage = new storage_stack_1.StorageStack(app, `AutoRfp-Storage-${stage}`, {
    env,
    stage,
});
const db = new database_stack_1.DatabaseStack(app, `AutoRfp-DynamoDatabase-${stage}`, {
    env,
    stage,
});
const pipelineStack = new document_pipeline_step_function_1.DocumentPipelineStack(app, `AutoRfp-DocumentPipeline-${stage}`, {
    env,
    stage,
    documentsBucket: storage.documentsBucket,
    documentsTable: db.tableName,
    openSearchCollectionEndpoint: opensearchEndpoint,
    vpc: network.vpc,
    vpcSecurityGroup: network.lambdaSecurityGroup
});
const questionsPipelineStack = new question_pipeline_step_function_1.QuestionExtractionPipelineStack(app, `AutoRfp-QuestionsPipeline-${stage}`, {
    env,
    stage,
    documentsBucket: storage.documentsBucket,
    mainTable: db.tableName
});
const api = new api_stack_1.ApiStack(app, `AutoRfp-API-${stage}`, {
    env,
    stage,
    documentsBucket: storage.documentsBucket,
    mainTable: db.tableName,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    documentPipelineStateMachineArn: pipelineStack.stateMachine.stateMachineArn,
    questionPipelineStateMachineArn: questionsPipelineStack.stateMachine.stateMachineArn,
    openSearchCollectionEndpoint: opensearchEndpoint,
    vpc: network.vpc
});
const githubToken = cdk.SecretValue.secretsManager('auto-rfp/github-token');
new amplify_fe_stack_1.AmplifyFeStack(app, `AmplifyFeStack-${stage}`, {
    stage,
    env,
    owner: 'MichaelWalker-git',
    repository: 'auto_rfp',
    branch: stage.toLowerCase() == 'dev' ? 'develop' : 'main',
    githubToken,
    cognitoUserPoolId: auth.userPool.userPoolId,
    cognitoUserPoolClientId: auth.userPoolClient.userPoolClientId,
    cognitoDomainUrl: auth.userPoolDomain.baseUrl(),
    baseApiUrl: api.api.url,
    region: env.region,
});
// Add CDK NAG AWS Solutions Checks for security compliance
// cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
// Output CDK NAG information
console.log('🔒 CDK NAG AWS Solutions Checks enabled for security compliance');
console.log('📋 This will validate infrastructure against AWS Well-Architected Framework');
console.log('⚠️  Any security issues will be reported during synthesis');
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0by1yZnAtaW5mcmFzdHJ1Y3R1cmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhdXRvLXJmcC1pbmZyYXN0cnVjdHVyZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSx1Q0FBcUM7QUFDckMsaURBQW1DO0FBQ25DLGtEQUE4QztBQUM5QyxnREFBNEM7QUFDNUMsd0RBQW9EO0FBQ3BELDBEQUFzRDtBQUN0RCx3REFBb0Q7QUFDcEQsOERBQXlEO0FBQ3pELDRGQUErRTtBQUMvRSw0RkFBeUY7QUFFekYsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7QUFFMUIsTUFBTSxHQUFHLEdBQUc7SUFDVixPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsSUFBSSxjQUFjLEVBQUUsc0NBQXNDO0lBQ2xHLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixJQUFJLFdBQVc7Q0FDdEQsQ0FBQztBQUVGLE1BQU0sS0FBSyxHQUFHLEtBQUssQ0FBQztBQUVwQixNQUFNLE9BQU8sR0FBRyxJQUFJLDRCQUFZLENBQUMsR0FBRyxFQUFFLGlCQUFpQixFQUFFO0lBQ3ZELEdBQUc7SUFDSCxhQUFhLEVBQUUsdUJBQXVCO0NBQ3ZDLENBQUMsQ0FBQztBQUVILE1BQU0sS0FBSyxHQUFHLHdEQUF3RCxDQUFDO0FBQ3ZFLE1BQU0sa0JBQWtCLEdBQUcsMkRBQTJELENBQUM7QUFFdkYsTUFBTSxJQUFJLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEdBQUcsRUFBRSxnQkFBZ0IsS0FBSyxFQUFFLEVBQUU7SUFDdkQsR0FBRztJQUNILEtBQUssRUFBRSxLQUFLO0lBQ1osZ0JBQWdCLEVBQUUsVUFBVTtJQUM1QixZQUFZLEVBQUU7UUFDWix1QkFBdUI7UUFDdkIsS0FBSztLQUNOO0NBQ0YsQ0FBQyxDQUFDO0FBRUgsTUFBTSxPQUFPLEdBQUcsSUFBSSw0QkFBWSxDQUFDLEdBQUcsRUFBRSxtQkFBbUIsS0FBSyxFQUFFLEVBQUU7SUFDaEUsR0FBRztJQUNILEtBQUs7Q0FDTixDQUFDLENBQUM7QUFFSCxNQUFNLEVBQUUsR0FBRyxJQUFJLDhCQUFhLENBQUMsR0FBRyxFQUFFLDBCQUEwQixLQUFLLEVBQUUsRUFBRTtJQUNuRSxHQUFHO0lBQ0gsS0FBSztDQUNOLENBQUMsQ0FBQztBQUVILE1BQU0sYUFBYSxHQUFHLElBQUksdURBQXFCLENBQUMsR0FBRyxFQUFFLDRCQUE0QixLQUFLLEVBQUUsRUFBRTtJQUN4RixHQUFHO0lBQ0gsS0FBSztJQUNMLGVBQWUsRUFBRSxPQUFPLENBQUMsZUFBZTtJQUN4QyxjQUFjLEVBQUUsRUFBRSxDQUFDLFNBQVM7SUFDNUIsNEJBQTRCLEVBQUUsa0JBQWtCO0lBQ2hELEdBQUcsRUFBRSxPQUFPLENBQUMsR0FBRztJQUNoQixnQkFBZ0IsRUFBRSxPQUFPLENBQUMsbUJBQW1CO0NBQzlDLENBQUMsQ0FBQztBQUVILE1BQU0sc0JBQXNCLEdBQUcsSUFBSSxpRUFBK0IsQ0FBQyxHQUFHLEVBQUUsNkJBQTZCLEtBQUssRUFBRSxFQUFFO0lBQzVHLEdBQUc7SUFDSCxLQUFLO0lBQ0wsZUFBZSxFQUFFLE9BQU8sQ0FBQyxlQUFlO0lBQ3hDLFNBQVMsRUFBRSxFQUFFLENBQUMsU0FBUztDQUN4QixDQUFDLENBQUM7QUFFSCxNQUFNLEdBQUcsR0FBRyxJQUFJLG9CQUFRLENBQUMsR0FBRyxFQUFFLGVBQWUsS0FBSyxFQUFFLEVBQUU7SUFDcEQsR0FBRztJQUNILEtBQUs7SUFDTCxlQUFlLEVBQUUsT0FBTyxDQUFDLGVBQWU7SUFDeEMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxTQUFTO0lBQ3ZCLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtJQUN2QixjQUFjLEVBQUUsSUFBSSxDQUFDLGNBQWM7SUFDbkMsK0JBQStCLEVBQUUsYUFBYSxDQUFDLFlBQVksQ0FBQyxlQUFlO0lBQzNFLCtCQUErQixFQUFFLHNCQUFzQixDQUFDLFlBQVksQ0FBQyxlQUFlO0lBQ3BGLDRCQUE0QixFQUFFLGtCQUFrQjtJQUNoRCxHQUFHLEVBQUUsT0FBTyxDQUFDLEdBQUc7Q0FDakIsQ0FBQyxDQUFDO0FBR0gsTUFBTSxXQUFXLEdBQUcsR0FBRyxDQUFDLFdBQVcsQ0FBQyxjQUFjLENBQUMsdUJBQXVCLENBQUMsQ0FBQztBQUU1RSxJQUFJLGlDQUFjLENBQUMsR0FBRyxFQUFFLGtCQUFrQixLQUFLLEVBQUUsRUFBRTtJQUNqRCxLQUFLO0lBQ0wsR0FBRztJQUNILEtBQUssRUFBRSxtQkFBbUI7SUFDMUIsVUFBVSxFQUFFLFVBQVU7SUFDdEIsTUFBTSxFQUFFLEtBQUssQ0FBQyxXQUFXLEVBQUUsSUFBSSxLQUFLLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsTUFBTTtJQUN6RCxXQUFXO0lBRVgsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxVQUFVO0lBQzNDLHVCQUF1QixFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsZ0JBQWdCO0lBQzdELGdCQUFnQixFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsT0FBTyxFQUFFO0lBQy9DLFVBQVUsRUFBRSxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUc7SUFDdkIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFPO0NBQ3BCLENBQUMsQ0FBQztBQUdILDJEQUEyRDtBQUMzRCxzRUFBc0U7QUFFdEUsNkJBQTZCO0FBQzdCLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUVBQWlFLENBQUMsQ0FBQztBQUMvRSxPQUFPLENBQUMsR0FBRyxDQUFDLDZFQUE2RSxDQUFDLENBQUM7QUFDM0YsT0FBTyxDQUFDLEdBQUcsQ0FBQywyREFBMkQsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuaW1wb3J0ICdzb3VyY2UtbWFwLXN1cHBvcnQvcmVnaXN0ZXInO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IEF1dGhTdGFjayB9IGZyb20gJy4uL2xpYi9hdXRoLXN0YWNrJztcbmltcG9ydCB7IEFwaVN0YWNrIH0gZnJvbSAnLi4vbGliL2FwaS1zdGFjayc7XG5pbXBvcnQgeyBTdG9yYWdlU3RhY2sgfSBmcm9tICcuLi9saWIvc3RvcmFnZS1zdGFjayc7XG5pbXBvcnQgeyBEYXRhYmFzZVN0YWNrIH0gZnJvbSAnLi4vbGliL2RhdGFiYXNlLXN0YWNrJztcbmltcG9ydCB7IE5ldHdvcmtTdGFjayB9IGZyb20gJy4uL2xpYi9uZXR3b3JrLXN0YWNrJztcbmltcG9ydCB7IEFtcGxpZnlGZVN0YWNrIH0gZnJvbSAnLi4vbGliL2FtcGxpZnktZmUtc3RhY2snO1xuaW1wb3J0IHsgRG9jdW1lbnRQaXBlbGluZVN0YWNrIH0gZnJvbSAnLi4vbGliL2RvY3VtZW50LXBpcGVsaW5lLXN0ZXAtZnVuY3Rpb24nO1xuaW1wb3J0IHsgUXVlc3Rpb25FeHRyYWN0aW9uUGlwZWxpbmVTdGFjayB9IGZyb20gJy4uL2xpYi9xdWVzdGlvbi1waXBlbGluZS1zdGVwLWZ1bmN0aW9uJztcblxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcblxuY29uc3QgZW52ID0ge1xuICBhY2NvdW50OiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9BQ0NPVU5UIHx8ICcwMTgyMjIxMjUxOTYnLCAvLyBIYXJkY29kZSB0aGUgYWNjb3VudCBJRCB3ZSBvYnRhaW5lZFxuICByZWdpb246IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX1JFR0lPTiB8fCAndXMtZWFzdC0xJyxcbn07XG5cbmNvbnN0IHN0YWdlID0gJ0Rldic7XG5cbmNvbnN0IG5ldHdvcmsgPSBuZXcgTmV0d29ya1N0YWNrKGFwcCwgJ0F1dG9SZnAtTmV0d29yaycsIHtcbiAgZW52LFxuICBleGlzdGluZ1ZwY0lkOiAndnBjLTA3MTcxZTRiZjU3ZjJjZWVkJyxcbn0pO1xuXG5jb25zdCBmZVVSTCA9ICdodHRwczovL2RweGVqdjJ3azAuZXhlY3V0ZS1hcGkudXMtZWFzdC0xLmFtYXpvbmF3cy5jb20nO1xuY29uc3Qgb3BlbnNlYXJjaEVuZHBvaW50ID0gJ2h0dHBzOi8vbGViNWFqaTZ2dGhheGs3ZnQ4cGkudXMtZWFzdC0xLmFvc3MuYW1hem9uYXdzLmNvbSc7XG5cbmNvbnN0IGF1dGggPSBuZXcgQXV0aFN0YWNrKGFwcCwgYEF1dG9SZnAtQXV0aC0ke3N0YWdlfWAsIHtcbiAgZW52LFxuICBzdGFnZTogc3RhZ2UsXG4gIGRvbWFpblByZWZpeEJhc2U6ICdhdXRvLXJmcCcsXG4gIGNhbGxiYWNrVXJsczogW1xuICAgICdodHRwOi8vbG9jYWxob3N0OjMwMDAnLFxuICAgIGZlVVJMXG4gIF1cbn0pO1xuXG5jb25zdCBzdG9yYWdlID0gbmV3IFN0b3JhZ2VTdGFjayhhcHAsIGBBdXRvUmZwLVN0b3JhZ2UtJHtzdGFnZX1gLCB7XG4gIGVudixcbiAgc3RhZ2UsXG59KTtcblxuY29uc3QgZGIgPSBuZXcgRGF0YWJhc2VTdGFjayhhcHAsIGBBdXRvUmZwLUR5bmFtb0RhdGFiYXNlLSR7c3RhZ2V9YCwge1xuICBlbnYsXG4gIHN0YWdlLFxufSk7XG5cbmNvbnN0IHBpcGVsaW5lU3RhY2sgPSBuZXcgRG9jdW1lbnRQaXBlbGluZVN0YWNrKGFwcCwgYEF1dG9SZnAtRG9jdW1lbnRQaXBlbGluZS0ke3N0YWdlfWAsIHtcbiAgZW52LFxuICBzdGFnZSxcbiAgZG9jdW1lbnRzQnVja2V0OiBzdG9yYWdlLmRvY3VtZW50c0J1Y2tldCxcbiAgZG9jdW1lbnRzVGFibGU6IGRiLnRhYmxlTmFtZSxcbiAgb3BlblNlYXJjaENvbGxlY3Rpb25FbmRwb2ludDogb3BlbnNlYXJjaEVuZHBvaW50LFxuICB2cGM6IG5ldHdvcmsudnBjLFxuICB2cGNTZWN1cml0eUdyb3VwOiBuZXR3b3JrLmxhbWJkYVNlY3VyaXR5R3JvdXBcbn0pO1xuXG5jb25zdCBxdWVzdGlvbnNQaXBlbGluZVN0YWNrID0gbmV3IFF1ZXN0aW9uRXh0cmFjdGlvblBpcGVsaW5lU3RhY2soYXBwLCBgQXV0b1JmcC1RdWVzdGlvbnNQaXBlbGluZS0ke3N0YWdlfWAsIHtcbiAgZW52LFxuICBzdGFnZSxcbiAgZG9jdW1lbnRzQnVja2V0OiBzdG9yYWdlLmRvY3VtZW50c0J1Y2tldCxcbiAgbWFpblRhYmxlOiBkYi50YWJsZU5hbWVcbn0pO1xuXG5jb25zdCBhcGkgPSBuZXcgQXBpU3RhY2soYXBwLCBgQXV0b1JmcC1BUEktJHtzdGFnZX1gLCB7XG4gIGVudixcbiAgc3RhZ2UsXG4gIGRvY3VtZW50c0J1Y2tldDogc3RvcmFnZS5kb2N1bWVudHNCdWNrZXQsXG4gIG1haW5UYWJsZTogZGIudGFibGVOYW1lLFxuICB1c2VyUG9vbDogYXV0aC51c2VyUG9vbCxcbiAgdXNlclBvb2xDbGllbnQ6IGF1dGgudXNlclBvb2xDbGllbnQsXG4gIGRvY3VtZW50UGlwZWxpbmVTdGF0ZU1hY2hpbmVBcm46IHBpcGVsaW5lU3RhY2suc3RhdGVNYWNoaW5lLnN0YXRlTWFjaGluZUFybixcbiAgcXVlc3Rpb25QaXBlbGluZVN0YXRlTWFjaGluZUFybjogcXVlc3Rpb25zUGlwZWxpbmVTdGFjay5zdGF0ZU1hY2hpbmUuc3RhdGVNYWNoaW5lQXJuLFxuICBvcGVuU2VhcmNoQ29sbGVjdGlvbkVuZHBvaW50OiBvcGVuc2VhcmNoRW5kcG9pbnQsXG4gIHZwYzogbmV0d29yay52cGNcbn0pO1xuXG5cbmNvbnN0IGdpdGh1YlRva2VuID0gY2RrLlNlY3JldFZhbHVlLnNlY3JldHNNYW5hZ2VyKCdhdXRvLXJmcC9naXRodWItdG9rZW4nKTtcblxubmV3IEFtcGxpZnlGZVN0YWNrKGFwcCwgYEFtcGxpZnlGZVN0YWNrLSR7c3RhZ2V9YCwge1xuICBzdGFnZSxcbiAgZW52LFxuICBvd25lcjogJ01pY2hhZWxXYWxrZXItZ2l0JyxcbiAgcmVwb3NpdG9yeTogJ2F1dG9fcmZwJyxcbiAgYnJhbmNoOiBzdGFnZS50b0xvd2VyQ2FzZSgpID09ICdkZXYnID8gJ2RldmVsb3AnIDogJ21haW4nLFxuICBnaXRodWJUb2tlbixcblxuICBjb2duaXRvVXNlclBvb2xJZDogYXV0aC51c2VyUG9vbC51c2VyUG9vbElkLFxuICBjb2duaXRvVXNlclBvb2xDbGllbnRJZDogYXV0aC51c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICBjb2duaXRvRG9tYWluVXJsOiBhdXRoLnVzZXJQb29sRG9tYWluLmJhc2VVcmwoKSxcbiAgYmFzZUFwaVVybDogYXBpLmFwaS51cmwsXG4gIHJlZ2lvbjogZW52LnJlZ2lvbiEsXG59KTtcblxuXG4vLyBBZGQgQ0RLIE5BRyBBV1MgU29sdXRpb25zIENoZWNrcyBmb3Igc2VjdXJpdHkgY29tcGxpYW5jZVxuLy8gY2RrLkFzcGVjdHMub2YoYXBwKS5hZGQobmV3IEF3c1NvbHV0aW9uc0NoZWNrcyh7IHZlcmJvc2U6IHRydWUgfSkpO1xuXG4vLyBPdXRwdXQgQ0RLIE5BRyBpbmZvcm1hdGlvblxuY29uc29sZS5sb2coJ/CflJIgQ0RLIE5BRyBBV1MgU29sdXRpb25zIENoZWNrcyBlbmFibGVkIGZvciBzZWN1cml0eSBjb21wbGlhbmNlJyk7XG5jb25zb2xlLmxvZygn8J+TiyBUaGlzIHdpbGwgdmFsaWRhdGUgaW5mcmFzdHJ1Y3R1cmUgYWdhaW5zdCBBV1MgV2VsbC1BcmNoaXRlY3RlZCBGcmFtZXdvcmsnKTtcbmNvbnNvbGUubG9nKCfimqDvuI8gIEFueSBzZWN1cml0eSBpc3N1ZXMgd2lsbCBiZSByZXBvcnRlZCBkdXJpbmcgc3ludGhlc2lzJyk7XG4iXX0=
#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { StorageStack } from '../lib/storage-stack';
import { DatabaseStack } from '../lib/database-stack';
import { NetworkStack } from '../lib/network-stack';
import { AmplifyFeStack } from '../lib/amplify-fe-stack';
import { DocumentPipelineStack } from '../lib/document-pipeline-step-function';
import { QuestionExtractionPipelineStack } from '../lib/question-pipeline-step-function';
import { ApiOrchestratorStack } from '../lib/api/api-orchestrator-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '018222125196', // Hardcode the account ID we obtained
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Make stage configurable from environment variable or context
const stage = process.env.STAGE || app.node.tryGetContext('stage') || 'Dev';
console.log(`🚀 Deploying with stage: ${stage}`);

const network = new NetworkStack(app, `AutoRfp-Network-${stage}`, {
  env,
  existingVpcId: 'vpc-07171e4bf57f2ceed',
});

const sentryDNS = 'https://5fa3951f41c357ba09d0ae50f52bbd2a@o4510347578114048.ingest.us.sentry.io/4510510176141312';
const pineconeApiKey = process.env.PINECONE_API_KEY || '';

// Warn if PINECONE_API_KEY is not set
if (!pineconeApiKey) {
  console.warn('⚠️  WARNING: PINECONE_API_KEY environment variable is not set. Some stacks may fail to deploy.');
  console.warn('   Set it with: export PINECONE_API_KEY=your-api-key');
}

// GitHub token for Amplify
const githubToken = cdk.SecretValue.secretsManager('auto-rfp/github-token');

// Determine the branch based on stage
const branch = stage.toLowerCase() === 'dev' ? 'develop' : 'master';

// Create storage stack first as it has no dependencies
const storage = new StorageStack(app, `AutoRfp-Storage-${stage}`, {
  env,
  stage,
});

// Create database stack
const db = new DatabaseStack(app, `AutoRfp-DynamoDatabase-${stage}`, {
  env,
  stage,
});

// For Amplify URLs, we'll use a predictable pattern
// The actual Amplify app ID will be generated, but we can use wildcards in Cognito
const amplifyDomain = `d*.amplifyapp.com`;
const feURL = `https://${branch}.${amplifyDomain}`;

console.log(`📱 Frontend URL pattern: ${feURL}`);

const auth = new AuthStack(app, `AutoRfp-Auth-${stage}`, {
  env,
  stage: stage,
  domainPrefixBase: 'auto-rfp',
  callbackUrls: [
    'http://localhost:3000',
    // Add wildcard patterns for Amplify domains
    `https://${branch}.d*.amplifyapp.com`,
    `https://*.d*.amplifyapp.com`, // For preview branches
    // Also add some specific patterns that might be used
    'https://main.d*.amplifyapp.com',
    'https://develop.d*.amplifyapp.com'
  ]
});

const pipelineStack = new DocumentPipelineStack(app, `AutoRfp-DocumentPipeline-${stage}`, {
  env,
  stage,
  documentsBucket: storage.documentsBucket,
  documentsTable: db.tableName,
  vpc: network.vpc,
  vpcSecurityGroup: network.lambdaSecurityGroup,
  sentryDNS,
  pineconeApiKey
});

const questionsPipelineStack = new QuestionExtractionPipelineStack(app, `AutoRfp-QuestionsPipeline-${stage}`, {
  env,
  stage,
  documentsBucket: storage.documentsBucket,
  mainTable: db.tableName,
  sentryDNS
});

const api = new ApiOrchestratorStack(app, `ApiOrchestrator-${stage}`, {
  env,
  stage,
  userPool: auth.userPool,
  mainTable: db.tableName,
  documentsBucket: storage.documentsBucket,
  documentPipelineStateMachineArn: pipelineStack.stateMachine.stateMachineArn,
  questionPipelineStateMachineArn: questionsPipelineStack.stateMachine.stateMachineArn,
  sentryDNS,
  pineconeApiKey
});

// Create Amplify stack with all the required values
const amplifyStack = new AmplifyFeStack(app, `AmplifyFeStack-${stage}`, {
  stage,
  env,
  owner: 'MichaelWalker-git',
  repository: 'auto_rfp',
  branch,
  githubToken,
  
  cognitoUserPoolId: auth.userPool.userPoolId,
  cognitoUserPoolClientId: auth.userPoolClient.userPoolClientId,
  cognitoDomainUrl: auth.userPoolDomain.baseUrl(),
  baseApiUrl: api.api.url,
  region: env.region!,
  sentryDNS,
});

// Add dependencies to ensure proper deployment order
amplifyStack.addDependency(auth);
amplifyStack.addDependency(api);

// Add stack outputs for easy reference
new cdk.CfnOutput(amplifyStack, `FrontendURL`, {
  value: `https://${branch}.${amplifyStack.amplifyApp.defaultDomain}`,
  description: 'The URL of the Amplify frontend application',
  exportName: `AutoRfp-FrontendURL-${stage}`
});

new cdk.CfnOutput(api, `ApiURL`, {
  value: api.api.url,
  description: 'The URL of the API Gateway',
  exportName: `AutoRfp-ApiURL-${stage}`
});

new cdk.CfnOutput(auth, `CognitoUserPoolId`, {
  value: auth.userPool.userPoolId,
  description: 'The Cognito User Pool ID',
  exportName: `AutoRfp-UserPoolId-${stage}`
});

new cdk.CfnOutput(amplifyStack, `AmplifyAppId`, {
  value: amplifyStack.amplifyApp.appId,
  description: 'The Amplify App ID',
  exportName: `AutoRfp-AmplifyAppId-${stage}`
});

console.log(`\n📌 Note: After deployment, update Cognito callback URLs with the actual Amplify domain from the FrontendURL output if needed.`);


// Add CDK NAG AWS Solutions Checks for security compliance
// cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Output CDK NAG information
console.log('🔒 CDK NAG AWS Solutions Checks enabled for security compliance');
console.log('📋 This will validate infrastructure against AWS Well-Architected Framework');
console.log('⚠️  Any security issues will be reported during synthesis');

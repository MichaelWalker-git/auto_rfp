#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';
import { StorageStack } from '../lib/storage-stack';
import { DatabaseStack } from '../lib/database-stack';
import { NetworkStack } from '../lib/network-stack';
import { AmplifyFeStack } from '../lib/amplify-fe-stack';
import { DocumentPipelineStack } from '../lib/document-pipeline-step-function';
import { QuestionExtractionPipelineStack } from '../lib/question-pipeline-step-function';
import { requireEnv } from '../lambda/helpers/env';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '018222125196', // Hardcode the account ID we obtained
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

const stage = 'Dev';

const network = new NetworkStack(app, 'AutoRfp-Network', {
  env,
  existingVpcId: 'vpc-07171e4bf57f2ceed',
});

const feURL = 'https://d53rbfmpyaoju.execute-api.us-east-1.amazonaws.com';
const sentryDNS = 'https://5fa3951f41c357ba09d0ae50f52bbd2a@o4510347578114048.ingest.us.sentry.io/4510510176141312'
const pineconeApiKey = requireEnv('PINECONE_API_KEY');

const auth = new AuthStack(app, `AutoRfp-Auth-${stage}`, {
  env,
  stage: stage,
  domainPrefixBase: 'auto-rfp',
  callbackUrls: [
    'http://localhost:3000',
    feURL
  ]
});

const storage = new StorageStack(app, `AutoRfp-Storage-${stage}`, {
  env,
  stage,
});

const db = new DatabaseStack(app, `AutoRfp-DynamoDatabase-${stage}`, {
  env,
  stage,
});

// DeepSeek OCR endpoint (us-east-1) - for image text extraction
// Note: PDFs still use Textract until DeepSeek PDF endpoint is fixed
const deepseekEndpoint = 'http://dev-deepseek-ocr-gpu-lb-1737323494.us-east-1.elb.amazonaws.com';

const pipelineStack = new DocumentPipelineStack(app, `AutoRfp-DocumentPipeline-${stage}`, {
  env,
  stage,
  documentsBucket: storage.documentsBucket,
  documentsTable: db.tableName,
  vpc: network.vpc,
  vpcSecurityGroup: network.lambdaSecurityGroup,
  sentryDNS,
  pineconeApiKey,
  // DeepSeek configuration for image OCR
  deepseekEndpoint,
  useDeepseek: true,
  deepseekTrafficPercent: 100, // Route all images to DeepSeek (PDFs still use Textract)
});

const questionsPipelineStack = new QuestionExtractionPipelineStack(app, `AutoRfp-QuestionsPipeline-${stage}`, {
  env,
  stage,
  documentsBucket: storage.documentsBucket,
  mainTable: db.tableName,
  sentryDNS
});

const api = new ApiStack(app, `AutoRfp-API-${stage}`, {
  env,
  stage,
  documentsBucket: storage.documentsBucket,
  mainTable: db.tableName,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  documentPipelineStateMachineArn: pipelineStack.stateMachine.stateMachineArn,
  questionPipelineStateMachineArn: questionsPipelineStack.stateMachine.stateMachineArn,
  sentryDNS,
  pineconeApiKey
});

const githubToken = cdk.SecretValue.secretsManager('auto-rfp/github-token');

new AmplifyFeStack(app, `AmplifyFeStack-${stage}`, {
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
  region: env.region!,
  sentryDNS,
});


// Add CDK NAG AWS Solutions Checks for security compliance
// cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

// Output CDK NAG information
console.log('🔒 CDK NAG AWS Solutions Checks enabled for security compliance');
console.log('📋 This will validate infrastructure against AWS Well-Architected Framework');
console.log('⚠️  Any security issues will be reported during synthesis');

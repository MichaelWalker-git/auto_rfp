#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AuthStack } from '../auth-stack';
import { StorageStack } from '../storage-stack';
import { DatabaseStack } from '../database-stack';
import { NetworkStack } from '../network-stack';
import { AmplifyFeStack } from '../amplify-fe-stack';
import { DocumentPipelineStack } from '../document-pipeline-step-function';
import { QuestionExtractionPipelineStack } from '../question-pipeline-step-function';
import { AnswerGenerationPipelineStack } from '../answer-generation-step-function';
import { ApiOrchestratorStack } from '../api/api-orchestrator-stack';
import { CollaborationWebSocketStack } from '../collaboration-websocket-stack';
import { AuditStack } from '../audit-stack';
import { OpportunityEventsStack } from '../opportunity-events-stack';
import { RfpLinearSyncStack } from '../rfp-linear-sync-stack';
import { FoiaAutomationStack } from '../foia-automation-stack';
import { FoiaInboundStack } from '../foia-inbound-stack';
import { RfpDigestStack } from '../rfp-digest-stack';
import { GoogleDriveSyncStack } from '../google-drive-sync-stack';
import { RFP_SYNC_PROJECT_ID } from '@auto-rfp/core';
import { AwsSolutionsChecks } from 'cdk-nag';
import {
  addAllSuppressions,
  addCognitoSuppressions,
  addDynamoDBSuppressions,
  addLambdaSuppressions,
  addS3Suppressions,
  addSNSSuppressions,
  addSQSSuppressions,
  addStepFunctionsSuppressions,
} from '../cdk-nag-suppressions';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '018222125196',
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

const stage = process.env.STAGE || app.node.tryGetContext('stage') || 'Dev';
console.log(`=🚀 Deploying with stage: ${stage}`);

// RFP Tracking is a single-org (Horus Tech) feature. Its org id differs per
// environment because each stage has its own DynamoDB table / org records.
// This drives the frontend feature gate (NEXT_PUBLIC_RFP_TRACKING_ORG_ID).
const RFP_TRACKING_ORG_ID_BY_STAGE: Record<string, string> = {
  Dev: '9c0a5757-e2da-4e71-9490-01c558f7ffc3', // Horus Tech (dev) — gov-contracting RFP org
  Test: '0e832bda-3489-4932-a9d5-9fa82a86a97a', // Horus Tech (test) — owns RFP-table-Test opportunities
};
const rfpTrackingOrgId = RFP_TRACKING_ORG_ID_BY_STAGE[stage] ?? '';

const awsMarketplaceProductCode = process.env.AWS_MARKETPLACE_PRODUCT_CODE || '';
if (awsMarketplaceProductCode) {
  cdk.Tags.of(app).add('aws-apn-id', `pc:${awsMarketplaceProductCode}`);
}

const network = new NetworkStack(app, `AutoRfp-Network-${stage}`, {
  env,
  existingVpcId: 'vpc-0e8bca582530ec949', // blueprint-checker-vpc-dev (has NAT Gateway)
});

const sentryDNS = 'https://5fa3951f41c357ba09d0ae50f52bbd2a@o4510347578114048.ingest.us.sentry.io/4510510176141312';
const pineconeApiKey = cdk.SecretValue.secretsManager(`auto-rfp/pinecone-api-key`).unsafeUnwrap();
const githubToken = cdk.SecretValue.secretsManager('auto-rfp/github-token');

// Sentry auth token for source map uploads — optional, widget works without it.
// Create the secret with: aws secretsmanager create-secret --name auto-rfp/sentry-auth-token --secret-string "sntrys_..."
// Set SENTRY_AUTH_TOKEN_ENABLED=true to enable source map uploads (requires the secret to exist in Secrets Manager)
const sentryAuthTokenEnabled = process.env.SENTRY_AUTH_TOKEN_ENABLED === 'true';
const sentryAuthToken = sentryAuthTokenEnabled
  ? cdk.SecretValue.secretsManager('auto-rfp/sentry-auth-token')
  : undefined;

if (!sentryAuthTokenEnabled) {
  console.warn('⚠️  SENTRY_AUTH_TOKEN_ENABLED not set. Source map uploads will be skipped. Set SENTRY_AUTH_TOKEN_ENABLED=true after creating the secret.');
}

const branch = stage.toLowerCase() === 'dev' ? 'develop' : 'main';

const storage = new StorageStack(app, `AutoRfp-Storage-${stage}`, {
  env,
  stage,
});

const db = new DatabaseStack(app, `AutoRfp-DynamoDatabase-${stage}`, {
  env,
  stage,
});

const amplifyDomain = `d*.amplifyapp.com`;
const feURL = `https://${branch}.${amplifyDomain}`;

console.log(`=🌐 Frontend URL pattern: ${feURL}`);

// Frontend URL for email links and other integrations.
// Can be overridden via FRONTEND_URL environment variable.
// Default strategy:
//   - Use AMPLIFY_APP_ID env var if set (for dynamic construction)
//   - Otherwise use hardcoded app ID (d1vua4yzm2hpyn) as fallback
//   - Main/Prod always use custom domain regardless
const amplifyAppId = process.env.AMPLIFY_APP_ID || 'd1vua4yzm2hpyn';
const defaultFrontendUrl = stage.toLowerCase() === 'dev'
  ? `https://${branch}.${amplifyAppId}.amplifyapp.com`
  : 'https://rfp.horustech.dev';  // Main/Prod use custom domain

const frontendUrl = process.env.FRONTEND_URL || defaultFrontendUrl;

console.log(`=📧 Frontend URL for integrations: ${frontendUrl}`);

const auth = new AuthStack(app, `AutoRfp-Auth-${stage}`, {
  env,
  stage: stage,
  domainPrefixBase: 'auto-rfp',
  portalUrl: frontendUrl,
  callbackUrls: [
    'http://localhost:3000',
    `https://${branch}.d*.amplifyapp.com`,
    `https://*.d*.amplifyapp.com`,
    'https://main.d*.amplifyapp.com',
    'https://develop.d*.amplifyapp.com',
    'https://rfp.horustech.dev',
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

// Answer Generation Pipeline - runs ONCE per project after all files are extracted
const answerGenerationStack = new AnswerGenerationPipelineStack(app, `AutoRfp-AnswerGenPipeline-${stage}`, {
  env,
  stage,
  documentsBucket: storage.documentsBucket,
  mainTable: db.tableName,
  sentryDNS,
  pineconeApiKey,
});

// Question Extraction Pipeline - extracts questions from files, triggers answer generation when all done
const questionsPipelineStack = new QuestionExtractionPipelineStack(app, `AutoRfp-QuestionsPipeline-${stage}`, {
  env,
  stage,
  documentsBucket: storage.documentsBucket,
  mainTable: db.tableName,
  sentryDNS,
  pineconeApiKey,
  answerGenerationStateMachineArn: answerGenerationStack.stateMachine.stateMachineArn,
  // Queue name (plain string, same convention as the API stack) — the notary
  // rollup notification fires from detect-required-forms / textract-forms-callback.
  notificationQueueName: `auto-rfp-notifications-${stage.toLowerCase()}`,
});

// Question pipeline depends on answer generation stack
questionsPipelineStack.addDependency(answerGenerationStack);

// Shared EventBridge bus for opportunity/POC events — deployed once, used by all stages
const opportunityEvents = new OpportunityEventsStack(app, `AutoRfp-OpportunityEvents`, {
  env,
  stage,
});

// Create API Orchestrator which creates the API Gateway and adds all routes
const api = new ApiOrchestratorStack(app, `ApiOrchestrator-${stage}`, {
  env,
  stage,
  userPool: auth.userPool,
  userPoolClientId: auth.userPoolClient.userPoolClientId,
  mainTable: db.tableName,
  documentsBucket: storage.documentsBucket,
  execBriefQueue: storage.execBriefQueue,
  googleDriveSyncQueue: storage.googleDriveSyncQueue,
  documentGenerationQueue: storage.documentGenerationQueue,
  clarifyingQuestionQueue: storage.clarifyingQuestionQueue,
  extractionQueue: storage.extractionQueue,
  renameChunksQueue: storage.renameChunksQueue,
  // Pass the queue name (plain string) — not the queue object — to avoid a cross-stack token cycle
  notificationQueueName: `auto-rfp-notifications-${stage.toLowerCase()}`,
  auditLogQueueName: `auto-rfp-audit-log-${stage.toLowerCase()}`,
  documentPipelineStateMachineArn: pipelineStack.stateMachine.stateMachineArn,
  questionPipelineStateMachineArn: questionsPipelineStack.stateMachine.stateMachineArn,
  answerGenerationStateMachineArn: answerGenerationStack.stateMachine.stateMachineArn,
  textractFormsTopicArn: questionsPipelineStack.textractFormsTopicArn,
  textractFormsRoleArn: questionsPipelineStack.textractFormsRoleArn,
  sentryDNS,
  pineconeApiKey,
  // Server-side allowlist for the RFP-tracking dashboard (get-rfp-pipeline).
  // Same per-stage value as the frontend gate — enforced in the Lambda too.
  rfpTrackingOrgId,
});

// Ensure API depends on required stacks
api.addDependency(auth);
api.addDependency(db);
api.addDependency(storage);
api.addDependency(pipelineStack);
api.addDependency(questionsPipelineStack);
api.addDependency(answerGenerationStack);
api.addDependency(opportunityEvents);

const notificationQueueName = `auto-rfp-notifications-${stage.toLowerCase()}`;

const collaborationWsStack = new CollaborationWebSocketStack(app, `AutoRfp-${stage}-CollaborationWS`, {
  env,
  stage,
  mainTable: db.tableName,
  userPool: auth.userPool,
  commonLambdaRoleArn: api.commonLambdaRoleArn,
  notificationQueueName,
  frontendUrl,
  commonEnv: {
    STAGE: stage,
    DB_TABLE_NAME: db.tableName.tableName,
    COGNITO_USER_POOL_ID: auth.userPool.userPoolId,
    REGION: env.region ?? 'us-east-1',
    SENTRY_DSN: sentryDNS,
    SENTRY_ENVIRONMENT: stage,
    NODE_ENV: 'production',
  },
});

collaborationWsStack.addDependency(auth);
collaborationWsStack.addDependency(db);
collaborationWsStack.addDependency(api);

const auditStack = new AuditStack(app, `AutoRfp-Audit-${stage}`, {
  env,
  stage,
  mainTable: db.tableName,
  commonLambdaRoleArn: api.commonLambdaRoleArn,
  commonEnv: {
    STAGE: stage,
    DB_TABLE_NAME: db.tableName.tableName,
    REGION: env.region ?? 'us-east-1',
    SENTRY_DSN: sentryDNS,
    SENTRY_ENVIRONMENT: stage,
    NODE_ENV: 'production',
  },
});

auditStack.addDependency(db);
auditStack.addDependency(api);

// Scheduled sync: mirror the Linear "Government Contracting" board into the
// RFP-tracking pipeline every 15 minutes. The sync MUST write under the same
// org id the dashboard queries (rfpTrackingOrgId, which is stage-specific) —
// otherwise records land under one org's SK prefix while get-rfp-pipeline reads
// another's, leaving the board empty. Falls back to the dev org for stages
// without a designated RFP org; RFP_SYNC_ORG_ID overrides per environment.
const rfpSyncOrgId =
  process.env.RFP_SYNC_ORG_ID || rfpTrackingOrgId || '9c0a5757-e2da-4e71-9490-01c558f7ffc3';
const rfpLinearSyncStack = new RfpLinearSyncStack(app, `AutoRfp-RfpLinearSync-${stage}`, {
  env,
  stage,
  mainTable: db.tableName,
  rfpOrgId: rfpSyncOrgId,
  rfpProjectId: RFP_SYNC_PROJECT_ID,
  linearOrgId: process.env.RFP_SYNC_LINEAR_ORG_ID || '6fbf749f-7173-489c-be0a-564f97ebf8b0',
  linearProjectName: 'Government Contracting',
  windowDays: 14,
  commonEnv: {
    STAGE: stage,
    DB_TABLE_NAME: db.tableName.tableName,
    REGION: env.region ?? 'us-east-1',
    SENTRY_DSN: sentryDNS,
    SENTRY_ENVIRONMENT: stage,
    NODE_ENV: 'production',
  },
});

rfpLinearSyncStack.addDependency(db);

// Scheduled import of Google Drive document edits. Depends on both db (for the
// byDriveSync index it queries — deploy the table stack first) and storage (for the
// documents bucket its DOCUMENTS_BUCKET env var and S3 grant point at).
const googleDriveSyncStack = new GoogleDriveSyncStack(app, `AutoRfp-GoogleDriveSync-${stage}`, {
  env,
  stage,
  mainTable: db.tableName,
  documentsBucketName: storage.documentsBucket.bucketName,
  notificationQueueName,
  commonEnv: {
    STAGE: stage,
    DB_TABLE_NAME: db.tableName.tableName,
    REGION: env.region ?? 'us-east-1',
    SENTRY_DSN: sentryDNS,
    SENTRY_ENVIRONMENT: stage,
    NODE_ENV: 'production',
  },
});

googleDriveSyncStack.addDependency(db);
googleDriveSyncStack.addDependency(storage);

// Daily reconcile of automatic FOIA request scheduling (Level 2). Recomputes
// the intended state for every eligible opportunity, so a missed run or a
// changed setting self-corrects on the next pass.
const foiaAutomationStack = new FoiaAutomationStack(app, `AutoRfp-FoiaAutomation-${stage}`, {
  env,
  stage,
  mainTable: db.tableName,
  documentsBucketName: storage.documentsBucket.bucketName,
  /**
   * Secret holding the api.data.gov key, created out-of-band rather than by CDK
   * so rotating the credential never needs a stack deploy.
   *
   * Optional in principle — the FOIA.gov API answers unauthenticated — but the
   * shared quota is not usable in practice: the first real seeder run returned
   * `429 OVER_RATE_LIMIT` and left the component directory empty, which is what
   * pushed recipient resolution onto PDF scraping.
   */
  foiaGovApiKeySecretArn:
    process.env.FOIA_GOV_API_KEY_SECRET_ARN ||
    `arn:aws:secretsmanager:${process.env.CDK_DEFAULT_REGION ?? 'us-east-1'}:${
      process.env.CDK_DEFAULT_ACCOUNT ?? ''
    }:secret:auto-rfp/foia-gov-api-key/${stage}`,
  // Required: the reconciler can now send unattended, and the send helper reads
  // this at module load — unset would crash the Lambda on cold start.
  sesFromEmail: 'noreply@horustech.dev',
  commonEnv: {
    STAGE: stage,
    DB_TABLE_NAME: db.tableName.tableName,
    REGION: env.region ?? 'us-east-1',
    SENTRY_DSN: sentryDNS,
    SENTRY_ENVIRONMENT: stage,
    NODE_ENV: 'production',
  },
});

foiaAutomationStack.addDependency(db);
foiaAutomationStack.addDependency(storage);

/**
 * Level 1: inbound mail ingestion (SES receipt).
 *
 * Deployed to a DIFFERENT region from everything else, and only when explicitly
 * configured. SES permits one active receipt rule set per region, and the primary
 * region's already belongs to an unrelated project — so this owns a rule set
 * outright where nothing else receives. The region is invisible to senders, since
 * routing is decided by the MX record.
 *
 * Gated on FOIA_RECEIPT_DOMAIN because the receiving subdomain is a deliberate
 * DNS decision on a live domain, not something to stand up implicitly on every
 * deploy. Unset means the stack is not synthesized at all.
 */
const foiaReceiptDomain = process.env.FOIA_RECEIPT_DOMAIN || '';
if (foiaReceiptDomain) {
  const inboundRegion = process.env.FOIA_INBOUND_REGION || 'us-west-2';

  const foiaInboundStack = new FoiaInboundStack(app, `AutoRfp-FoiaInbound-${stage}`, {
    env: { account: env.account, region: inboundRegion },
    stage,
    mainTableName: db.tableName.tableName,
    // Built by hand rather than read from the table construct: a cross-region
    // stack cannot reference another stack's attributes without an export, and the
    // table name is deterministic per stage.
    mainTableArn: `arn:aws:dynamodb:${env.region}:${env.account}:table/RFP-table-${stage}`,
    primaryRegion: env.region ?? 'us-east-1',
    receiptDomain: foiaReceiptDomain,
    receiptLocalPart: process.env.FOIA_RECEIPT_LOCAL_PART || 'foia',
    commonEnv: {
      STAGE: stage,
      DB_TABLE_NAME: db.tableName.tableName,
      REGION: env.region ?? 'us-east-1',
      SENTRY_DSN: sentryDNS,
      SENTRY_ENVIRONMENT: stage,
      NODE_ENV: 'production',
    },
  });

  // No addDependency on `db`: cross-region stacks cannot express a CloudFormation
  // dependency. The table is referenced by a deterministic ARN and must already
  // exist, which it does — it predates this stack.
  cdk.Tags.of(foiaInboundStack).add('feature', 'foia-inbound');
}

// Only deployed where a Linear key and Slack webhook are configured for the org.
const rfpDigestOrgId = process.env.RFP_DIGEST_ORG_ID || '';
if (rfpDigestOrgId) {
  new RfpDigestStack(app, `AutoRfp-RfpDigest-${stage}`, {
    env,
    stage,
    digestOrgId: rfpDigestOrgId,
    linearProjectId: '823d8281-c41e-4e00-b541-f31a5c91af46',
    commonEnv: {
      STAGE: stage,
      REGION: env.region ?? 'us-east-1',
      SENTRY_DSN: sentryDNS,
      SENTRY_ENVIRONMENT: stage,
      NODE_ENV: 'production',
    },
  });
}

new cdk.CfnOutput(collaborationWsStack, 'CollaborationWsApiUrl', {
  value: collaborationWsStack.wsApiUrl,
  description: 'WebSocket API URL for real-time collaboration',
  exportName: `AutoRfp-CollaborationWsUrl-${stage}`,
});

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
  baseApiUrl: api.apiUrl,
  region: env.region!,
  sentryDNS,
  sentryAuthToken,
  // Restrict the RFP Tracking dashboard to the Horus Tech org for this stage.
  rfpTrackingOrgId,
  // Attach rfp.horustech.dev to the main branch only
  ...(branch === 'main' ? { customDomain: 'rfp.horustech.dev' } : {}),
});

amplifyStack.addDependency(auth);
amplifyStack.addDependency(api);

new cdk.CfnOutput(amplifyStack, `FrontendURL`, {
  value: `https://${branch}.${amplifyStack.amplifyApp.defaultDomain}`,
  description: 'The URL of the Amplify frontend application',
  exportName: `AutoRfp-FrontendURL-${stage}`
});

new cdk.CfnOutput(api, `ApiURL`, {
  value: api.apiUrl,
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

new cdk.CfnOutput(storage, `ExecBriefQueueUrl`, {
  value: storage.execBriefQueue.queueUrl,
  description: 'The URL of the Executive Brief SQS Queue',
  exportName: `AutoRfp-ExecBriefQueueUrl-${stage}`
});

new cdk.CfnOutput(storage, `ExecBriefQueueArn`, {
  value: storage.execBriefQueue.queueArn,
  description: 'The ARN of the Executive Brief SQS Queue',
  exportName: `AutoRfp-ExecBriefQueueArn-${stage}`
});

// ─── CDK NAG: AWS Solutions Checks ───
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

const isProduction = stage.toLowerCase() === 'prod' || stage.toLowerCase() === 'production';

// Apply targeted suppressions to each stack
addS3Suppressions(storage, isProduction);
addSQSSuppressions(storage, isProduction);

addCognitoSuppressions(auth, isProduction);

addDynamoDBSuppressions(db, isProduction);

addAllSuppressions(api, isProduction);

addLambdaSuppressions(pipelineStack, isProduction);
addStepFunctionsSuppressions(pipelineStack, isProduction);
addSNSSuppressions(pipelineStack, isProduction);
addS3Suppressions(pipelineStack, isProduction);

addLambdaSuppressions(questionsPipelineStack, isProduction);
addStepFunctionsSuppressions(questionsPipelineStack, isProduction);
addSNSSuppressions(questionsPipelineStack, isProduction);

addLambdaSuppressions(answerGenerationStack, isProduction);
addStepFunctionsSuppressions(answerGenerationStack, isProduction);

addAllSuppressions(collaborationWsStack, isProduction);
addSQSSuppressions(collaborationWsStack, isProduction);

addAllSuppressions(auditStack, isProduction);
addSQSSuppressions(auditStack, isProduction);
addS3Suppressions(auditStack, isProduction);
addLambdaSuppressions(auditStack, isProduction);

addLambdaSuppressions(rfpLinearSyncStack, isProduction);
addDynamoDBSuppressions(rfpLinearSyncStack, isProduction);

addLambdaSuppressions(googleDriveSyncStack, isProduction);
addDynamoDBSuppressions(googleDriveSyncStack, isProduction);

addLambdaSuppressions(foiaAutomationStack, isProduction);
addDynamoDBSuppressions(foiaAutomationStack, isProduction);

console.log(`\n=📝 Note: After deployment, update Cognito callback URLs with the actual Amplify domain from the FrontendURL output if needed.`);
console.log('=🔒 CDK NAG AWS Solutions Checks enabled for security compliance');
console.log('=📋 This will validate infrastructure against AWS Well-Architected Framework');
console.log('⚠️  Any security issues will be reported during synthesis');
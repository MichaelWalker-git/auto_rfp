import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { GoogleDriveSyncStack } from './google-drive-sync-stack';
import { DatabaseStack } from './database-stack';

describe('GoogleDriveSyncStack', () => {
  let template: Template;

  // beforeAll, not beforeEach: synthesizing this stack esbuilds a 14 MB bundle, so
  // per-test synthesis costs ~20s for a template every assertion only reads.
  beforeAll(() => {
    const app = new cdk.App();
    const helperStack = new cdk.Stack(app, 'HelperStack');
    const mockTable = dynamodb.Table.fromTableName(helperStack, 'MockTable', 'test-table');

    const stack = new GoogleDriveSyncStack(app, 'TestGoogleDriveSyncStack', {
      stage: 'test',
      mainTable: mockTable,
      documentsBucketName: 'test-documents-bucket',
      notificationQueueName: 'auto-rfp-notifications-test',
      commonEnv: {
        STAGE: 'test',
        DB_TABLE_NAME: 'test-table',
        REGION: 'us-east-1',
        NODE_ENV: 'production',
      },
    });

    template = Template.fromStack(stack);
  });

  it('passes DOCUMENTS_BUCKET to the poller', () => {
    // Four helpers requireEnv('DOCUMENTS_BUCKET') at module load, and the app's shared
    // commonEnv does not carry it — omitting it is a cold start crash, not a late error.
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'auto-rfp-gdrive-poll-test',
      Environment: {
        Variables: Match.objectLike({
          DOCUMENTS_BUCKET: 'test-documents-bucket',
          DB_TABLE_NAME: 'test-table',
          NOTIFICATION_QUEUE_URL: Match.anyValue(),
        }),
      },
    });
  });

  it('gives the poller enough memory and time for a whole pass', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'auto-rfp-gdrive-poll-test',
      Timeout: 300,
      MemorySize: 1024,
    });
  });

  it('runs on a 15 minute schedule', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(15 minutes)',
      State: 'ENABLED',
    });
  });

  it('retries a failed invocation at most once', () => {
    // The handler swallows per-org and per-document failures, so a retry can only
    // re-run an entire pass.
    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: Match.arrayWith([
        Match.objectLike({ RetryPolicy: { MaximumRetryAttempts: 1 } }),
      ]),
    });
  });

  it('reads only the Google credential, not every integration key', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'secretsmanager:GetSecretValue',
            // Region/account are tokens, so the ARN synthesizes to an Fn::Join whose
            // last fragment carries the literal secret-name prefix. Asserting on that
            // fragment is what distinguishes `google-api-key-*` from the broad
            // `*-api-key-*` that only commonLambdaRole is allowed to hold.
            Resource: {
              'Fn::Join': [
                '',
                Match.arrayWith([Match.stringLikeRegexp(':secret:google-api-key-\\*$')]),
              ],
            },
          }),
        ]),
      },
    });
  });

  it('does not grant access to the whole documents bucket', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['s3:GetObject', 's3:PutObject'],
            Resource: 'arn:aws:s3:::test-documents-bucket/*/*/*/rfp-documents/*',
          }),
        ]),
      },
    });
  });

  it('keeps log retention bounded outside prod', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/aws/lambda/auto-rfp-gdrive-poll-test',
      RetentionInDays: 14,
    });
  });

  it('uses its own execution role rather than a shared one', () => {
    template.resourceCountIs('AWS::IAM::Role', 1);
  });
});

describe('DatabaseStack byDriveSync index', () => {
  const template = Template.fromStack(
    new DatabaseStack(new cdk.App(), 'TestDatabaseStack', { stage: 'test' }),
  );

  it('declares the sparse index the poller enumerates through', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'byDriveSync',
          KeySchema: [
            { AttributeName: 'driveSyncPk', KeyType: 'HASH' },
            { AttributeName: 'driveSyncSk', KeyType: 'RANGE' },
          ],
          Projection: Match.objectLike({
            ProjectionType: 'INCLUDE',
            // The poller filters on deletedAt and the approval audience reads updatedBy;
            // an attribute missing from the projection reads back as undefined.
            NonKeyAttributes: Match.arrayWith([
              'documentId',
              'projectId',
              'opportunityId',
              'deletedAt',
              'updatedBy',
              'signatureStatus',
              'googleDriveFileId',
              'driveModifiedTime',
            ]),
          }),
        }),
      ]),
    });
  });

  it('leaves the existing byUserId index in place', () => {
    // CloudFormation allows only one GSI change per update; this must be the only one.
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'byUserId' })]),
    });
  });
});

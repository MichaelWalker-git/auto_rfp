import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DocumentPipelineStack } from './document-pipeline-step-function';

describe('DocumentPipelineStack', () => {
  let template: Template;

  beforeEach(() => {
    const app = new cdk.App();

    const helperStack = new cdk.Stack(app, 'HelperStack');

    const mockBucket = s3.Bucket.fromBucketName(helperStack, 'MockBucket', 'test-bucket');
    const mockTable = dynamodb.Table.fromTableName(helperStack, 'MockTable', 'test-table');

    const stack = new DocumentPipelineStack(app, 'TestStack', {
      stage: 'test',
      documentsBucket: mockBucket,
      documentsTable: mockTable,
      sentryDNS: 'https://test@sentry.io/test',
      pineconeApiKey: 'test-pinecone-key',
    });

    template = Template.fromStack(stack);
  });

  it('does not attach a VpcConfig to the IndexDocumentLambda function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'AutoRfp-test-IndexDocumentChunk',
      VpcConfig: Match.absent(),
    });
  });
});

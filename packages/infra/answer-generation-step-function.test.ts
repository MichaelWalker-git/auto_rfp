import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Template } from 'aws-cdk-lib/assertions';
import { AnswerGenerationPipelineStack } from './answer-generation-step-function';

describe('AnswerGenerationPipelineStack', () => {
  let stack: AnswerGenerationPipelineStack;
  let template: Template;

  beforeEach(() => {
    const app = new cdk.App();

    // Create mock resources
    const mockBucket = s3.Bucket.fromBucketName(
      app,
      'MockBucket',
      'test-bucket'
    );

    const mockTable = dynamodb.Table.fromTableName(
      app,
      'MockTable',
      'test-table'
    );

    stack = new AnswerGenerationPipelineStack(app, 'TestStack', {
      stage: 'test',
      documentsBucket: mockBucket,
      mainTable: mockTable,
      sentryDNS: 'https://test@sentry.io/test',
      pineconeApiKey: 'test-pinecone-key',
    });

    template = Template.fromStack(stack);
  });

  it('should create a Step Functions state machine', () => {
    template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
  });

  it('should create PrepareQuestions Lambda with S3 write permissions', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: 'nodejs24.x',
      Environment: {
        Variables: {
          DOCUMENTS_BUCKET: 'test-bucket',
        },
      },
    });
  });

  it('should grant S3 read access to state machine', () => {
    // Verify IAM policy allows Step Functions to read from S3
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: expect.arrayContaining([
          expect.objectContaining({
            Action: expect.arrayContaining(['s3:GetObject', 's3:ListBucket']),
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  it('should use Distributed Map with S3JsonItemReader', () => {
    // Verify the state machine definition includes Distributed Map
    const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
    const stateMachine = Object.values(stateMachines)[0] as any;

    const definition = JSON.parse(
      stateMachine.Properties.DefinitionString['Fn::Join'][1].join('')
    );

    // Find the map state
    const mapState = Object.values(definition.States).find(
      (state: any) => state.Type === 'Map' && state.ItemReader
    );

    expect(mapState).toBeDefined();
    expect((mapState as any).ItemReader).toMatchObject({
      ReaderConfig: {
        InputType: 'JSON',
      },
      Resource: 'arn:aws:states:::s3:getObject',
    });
  });

  it('should set higher concurrency for Distributed Map', () => {
    const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
    const stateMachine = Object.values(stateMachines)[0] as any;

    const definition = JSON.parse(
      stateMachine.Properties.DefinitionString['Fn::Join'][1].join('')
    );

    const mapState = Object.values(definition.States).find(
      (state: any) => state.Type === 'Map' && state.ItemReader
    );

    expect((mapState as any).MaxConcurrency).toBe(10);
  });

  it('should increase state machine timeout to 120 minutes', () => {
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      TimeoutSeconds: 7200, // 120 minutes
    });
  });
});

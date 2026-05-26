import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Template } from 'aws-cdk-lib/assertions';
import { QuestionExtractionPipelineStack } from './question-pipeline-step-function';

describe('QuestionExtractionPipelineStack', () => {
  let template: Template;

  beforeEach(() => {
    const app = new cdk.App();
    const helperStack = new cdk.Stack(app, 'HelperStack');

    const mockBucket = s3.Bucket.fromBucketName(helperStack, 'MockBucket', 'test-bucket');
    const mockTable = dynamodb.Table.fromTableName(helperStack, 'MockTable', 'test-table');

    const stack = new QuestionExtractionPipelineStack(app, 'TestStack', {
      stage: 'test',
      documentsBucket: mockBucket,
      mainTable: mockTable,
      sentryDNS: 'https://test@sentry.io/test',
      pineconeApiKey: 'test-pinecone-key',
    });

    template = Template.fromStack(stack);
  });

  it('passes orgId to each Index Solicitation task payload', () => {
    const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
    const stateMachine = Object.values(stateMachines)[0] as { Properties: { DefinitionString: { 'Fn::Join': [unknown, string[]] } } };

    const definition = JSON.parse(
      stateMachine.Properties.DefinitionString['Fn::Join'][1].join(''),
    ) as { States: Record<string, unknown> };

    const indexTasks = Object.entries(definition.States).filter(
      ([name]) => name.startsWith('Index Solicitation'),
    );

    expect(indexTasks).toHaveLength(3);

    for (const [name, state] of indexTasks) {
      const s = state as { Type: string; Parameters?: Record<string, unknown> };
      expect(s.Type).toBe('Task');

      // CDK encodes `sfn.JsonPath.stringAt('$.orgId')` as `orgId.$: '$.orgId'` inside Parameters.
      const serialized = JSON.stringify(s.Parameters ?? {});
      expect(serialized).toContain('"orgId.$":"$.orgId"');
      expect(serialized).toContain('"opportunityId.$":"$.oppId"');
      // `name` included so a failure pinpoints which task broke
      expect(name).toMatch(/Index Solicitation/);
    }
  });
});

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export interface DatabaseStackProps extends cdk.StackProps {
  /**
   * Stage name: e.g. "dev", "test", "prod"
   */
  stage: string;
}

export class DatabaseStack extends cdk.Stack {
  public readonly tableName: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { stage } = props;

    this.tableName = new dynamodb.Table(this, 'RFPTable', {
      tableName: `RFP-table-${stage}`,
      partitionKey: {
        name: 'partition_key',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: 'sort_key', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // change to RETAIN for prod
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
    });

    // GSI: Look up all entities by userId (e.g., find all orgs a user belongs to)
    this.tableName.addGlobalSecondaryIndex({
      indexName: 'byUserId',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'partition_key', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Outputs
    new cdk.CfnOutput(this, 'TableName', {
      value: this.tableName.tableName,
      description: 'DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'TableArn', {
      value: this.tableName.tableArn,
      description: 'DynamoDB table ARN for organizations',
    });
  }
}

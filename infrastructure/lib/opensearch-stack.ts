import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as oss from 'aws-cdk-lib/aws-opensearchserverless';

export interface OpenSearchServerlessStackProps extends cdk.StackProps {
  stage: string;
}

/**
 * Creates an OpenSearch Serverless VECTORSEARCH collection for RAG
 * and grants access to the auto-rfp Lambda role:
 *   arn:aws:iam::<account>:role/auto-rfp-api-lambda-role-<stage>
 *
 * Exposes:
 *   - collectionEndpoint: used as OPENSEARCH_ENDPOINT
 *   - indexName: logical index name (OPENSEARCH_INDEX)
 */
export class OpenSearchServerlessStack extends cdk.Stack {
  public readonly collectionEndpoint: string;
  public readonly indexName: string;

  constructor(scope: Construct, id: string, props: OpenSearchServerlessStackProps) {
    super(scope, id, props);

    const { stage } = props;

    const collectionName = `auto-rfp-rag-${stage}`;
    const indexName = `auto-rfp-rag-index-${stage}`;
    this.indexName = indexName;

    // 1) VECTORSEARCH collection
    const collection = new oss.CfnCollection(this, 'RagCollection', {
      name: collectionName,
      type: 'VECTORSEARCH',
      description: `AutoRFP RAG collection (${stage})`,
    });

    // 2) Encryption policy (AWS-owned key)
    new oss.CfnSecurityPolicy(this, 'RagEncryptionPolicy', {
      name: `auto-rfp-rag-encryption-${stage.toLowerCase()}`,
      type: 'encryption',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
            },
            {
              ResourceType: 'index',
              Resource: [`index/${collectionName}/*`],
            },
          ],
          AWSOwnedKey: true,
        },
      ]),
    });

    // 3) Network policy
    // DEV: Allow from public; tighten to VPC / CIDR for prod.
    new oss.CfnSecurityPolicy(this, 'RagNetworkPolicy', {
      name: `auto-rfp-rag-network-${stage.toLowerCase()}`,
      type: 'network',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
            },
            {
              ResourceType: 'dashboard',
              Resource: ['dashboard/*'],
            },
          ],
          AllowFromPublic: true, // TODO: lock down in production
        },
      ]),
    });

    // 4) Data access policy: allow your Lambda role to read/write documents
    // Matches the roleName you use in ApiStack: auto-rfp-api-lambda-role-<stage>
    const lambdaRoleArn = `arn:aws:iam::${cdk.Stack.of(this).account}:role/auto-rfp-api-lambda-role-${stage}`;

    new oss.CfnAccessPolicy(this, 'RagDataAccessPolicy', {
      name: `auto-rfp-rag-access-${stage.toLowerCase()}`,
      type: 'data',
      policy: JSON.stringify([
        {
          Description: 'Lambda access to AutoRFP RAG collection/index',
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
              Permission: [
                'aoss:DescribeCollectionItems',
                'aoss:APIAccessAll',
              ],
            },
            {
              ResourceType: 'index',
              Resource: [`index/${collectionName}/*`],
              Permission: [
                'aoss:CreateIndex',
                'aoss:UpdateIndex',
                'aoss:DescribeIndex',
                'aoss:ReadDocument',
                'aoss:WriteDocument',
              ],
            },
          ],
          Principal: [lambdaRoleArn],
        },
      ]),
    });

    // 5) Expose endpoint
    this.collectionEndpoint = collection.attrCollectionEndpoint;

    new cdk.CfnOutput(this, 'OpenSearchCollectionName', {
      value: collectionName,
      description: 'OpenSearch Serverless collection name',
    });

    new cdk.CfnOutput(this, 'OpenSearchCollectionEndpoint', {
      value: this.collectionEndpoint,
      description: 'OpenSearch Serverless collection endpoint (for OPENSEARCH_ENDPOINT)',
    });

    new cdk.CfnOutput(this, 'OpenSearchIndexName', {
      value: this.indexName,
      description: 'Default RAG index name (for OPENSEARCH_INDEX)',
    });
  }
}

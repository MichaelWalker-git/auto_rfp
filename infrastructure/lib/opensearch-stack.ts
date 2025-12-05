import * as cdk from 'aws-cdk-lib';
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as oss from 'aws-cdk-lib/aws-opensearchserverless';

export interface OpenSearchServerlessStackProps extends StackProps {
  stage: string;
}

/**
 * Provisions an OpenSearch Serverless SEARCH collection and
 * exposes its HTTPS endpoint.
 *
 * Use `collectionEndpoint` in your DocumentPipelineStack env:
 *   OPENSEARCH_ENDPOINT = osStack.collectionEndpoint
 */
export class OpenSearchServerlessStack extends Stack {
  public readonly collection: oss.CfnCollection;
  public readonly collectionName: string;
  public readonly collectionEndpoint: string;

  constructor(scope: Construct, id: string, props: OpenSearchServerlessStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // Normalized collection name (lowercase, no weird chars)
    const baseName = `auto-rfp-${stage}-docs`.toLowerCase();
    this.collectionName = baseName.replace(/[^a-z0-9-]/g, '-');

    //
    // 1) Encryption policy – must exist BEFORE the collection
    //
    const encryptionPolicy = new oss.CfnSecurityPolicy(
      this,
      'DocumentsEncryptionPolicy',
      {
        name: `${this.collectionName}-enc-policy`,
        type: 'encryption',
        description: `Encryption policy for ${this.collectionName}`,
        policy: JSON.stringify({
          Rules: [
            {
              // Apply to all collections, including this one
              Resource: ['collection/*'],
              ResourceType: 'collection',
            },
          ],
          AWSOwnedKey: true,
        }),
      },
    );

    //
    // 2) Network policy – allow public HTTPS access but IAM-protected
    //
    const networkPolicy = new oss.CfnSecurityPolicy(
      this,
      'DocumentsNetworkPolicy',
      {
        name: `${this.collectionName}-net-policy`,
        type: 'network',
        description: `Network policy for ${this.collectionName}`,
        policy: JSON.stringify([
          {
            Description:
              'Public HTTPS access to collections, restricted by IAM',
            Rules: [
              {
                Resource: ['collection/*'],
                ResourceType: 'collection',
              },
            ],
            AllowFromPublic: true,
          },
        ]),
      },
    );

    //
    // 3) Collection – depends on both policies (fixes your error)
    //
    this.collection = new oss.CfnCollection(this, 'DocumentsCollection', {
      name: this.collectionName,
      description: `Serverless collection for AutoRFP document embeddings (${stage})`,
      type: 'SEARCH',
    });
    this.collection.addDependency(encryptionPolicy);
    this.collection.addDependency(networkPolicy);

    //
    // 4) Expose endpoint for other stacks
    //
    this.collectionEndpoint = this.collection.attrCollectionEndpoint;

    new cdk.CfnOutput(this, 'CollectionName', {
      value: this.collectionName,
      exportName: `${this.stackName}-CollectionName`,
    });

    new cdk.CfnOutput(this, 'CollectionEndpoint', {
      value: this.collectionEndpoint,
      exportName: `${this.stackName}-CollectionEndpoint`,
    });
  }
}

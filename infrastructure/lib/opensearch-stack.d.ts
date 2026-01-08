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
export declare class OpenSearchServerlessStack extends Stack {
    readonly collection: oss.CfnCollection;
    readonly collectionName: string;
    readonly collectionEndpoint: string;
    constructor(scope: Construct, id: string, props: OpenSearchServerlessStackProps);
}

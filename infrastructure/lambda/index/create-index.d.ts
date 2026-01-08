import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
/**
 * Main handler: given s3Key => read text => chunk => embed => index into OpenSearch.
 */
export declare const handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
export declare const handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
export declare function listDocuments(knowledgeBaseId: string): Promise<any[]>;

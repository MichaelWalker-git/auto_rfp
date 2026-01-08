import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { KnowledgeBase } from '../schemas/knowledge-base';
export declare const handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
export declare function getKnowledgeBase(orgId: string, kbId: string): Promise<KnowledgeBase | null>;

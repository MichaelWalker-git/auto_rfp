import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { CreateKnowledgeBaseDTO, KnowledgeBase } from '../schemas/knowledge-base';
export declare const handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
export declare function createKnowledgeBase(orgId: string, kbData: CreateKnowledgeBaseDTO): Promise<KnowledgeBase>;

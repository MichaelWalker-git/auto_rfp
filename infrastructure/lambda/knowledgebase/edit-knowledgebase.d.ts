import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateKnowledgeBaseDTO } from '../schemas/knowledge-base';
export declare const handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
export declare function updateKnowledgeBase(orgId: string, kbId: string, data: UpdateKnowledgeBaseDTO): Promise<{
    id: string;
    name: string;
    description: string | undefined;
    createdAt: string;
    updatedAt: string;
    _count: {
        questions: number;
    };
}>;

import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { CreateDocumentDTO, DocumentItem } from '../schemas/document';
export declare const handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
export declare function createDocument(dto: CreateDocumentDTO): Promise<DocumentItem>;

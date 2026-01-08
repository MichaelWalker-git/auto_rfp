import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { AnswerItem, CreateAnswerDTO } from '../schemas/answer';
export declare const handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
export declare function createAnswer(dto: CreateAnswerDTO): Promise<AnswerItem>;

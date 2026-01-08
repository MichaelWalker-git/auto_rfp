import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants/common';
export declare const CreateProjectSchema: z.ZodObject<{
    orgId: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CreateProjectDTO = z.infer<typeof CreateProjectSchema>;
export type ProjectItem = CreateProjectDTO & {
    [PK_NAME]: string;
    [SK_NAME]: string;
    id: string;
    createdAt: string;
    updatedAt: string;
};
export declare const handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;
export declare function createProject(dto: CreateProjectDTO): Promise<ProjectItem>;

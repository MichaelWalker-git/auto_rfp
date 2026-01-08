import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants/common';
export declare const CreateSecurityStaffSchema: z.ZodObject<{
    email: z.ZodString;
    name: z.ZodString;
    organizationId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CreateSecurityStaffDTO = z.infer<typeof CreateSecurityStaffSchema>;
export type SecurityStaffItem = CreateSecurityStaffDTO & {
    [PK_NAME]: string;
    [SK_NAME]: string;
    id: string;
    createdAt: string;
    updatedAt: string;
    cognitoUsername: string;
    role: 'SECURITY_STAFF';
};
export declare const handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

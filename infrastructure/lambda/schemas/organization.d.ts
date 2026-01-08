import { z } from 'zod';
/**
 * Zod Schema for the incoming request body (Data Transfer Object)
 * It defines the shape and validation rules for the organization data.
 */
export declare const CreateOrganizationSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    bucketName: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Infer the TypeScript type from the schema for compile-time safety.
 * This is the exact shape of the validated request body.
 */
export type CreateOrganizationDTO = z.infer<typeof CreateOrganizationSchema>;
export declare const OrganizationItemSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    bucketName: z.ZodOptional<z.ZodString>;
    partition_key: z.ZodString;
    sort_key: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    id: z.ZodString;
}, z.core.$strip>;
/**
 * Infer the full TypeScript type for the DynamoDB record.
 */
export type OrganizationItem = z.infer<typeof OrganizationItemSchema>;
export declare const UpdateOrganizationSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    bucketName: z.ZodOptional<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type UpdateOrganizationDTO = z.infer<typeof UpdateOrganizationSchema>;

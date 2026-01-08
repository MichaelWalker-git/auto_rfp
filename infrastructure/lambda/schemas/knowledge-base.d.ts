import { z } from 'zod';
export declare const KnowledgeBaseCountSchema: z.ZodObject<{
    questions: z.ZodNumber;
}, z.core.$strip>;
export declare const KnowledgeBaseBaseSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const CreateKnowledgeBaseSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CreateKnowledgeBaseDTO = z.infer<typeof CreateKnowledgeBaseSchema>;
export declare const KnowledgeBaseItemSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    partition_key: z.ZodString;
    sort_key: z.ZodString;
    orgId: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    _count: z.ZodDefault<z.ZodObject<{
        questions: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type KnowledgeBaseItem = z.infer<typeof KnowledgeBaseItemSchema>;
export declare const KnowledgeBaseSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    id: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    _count: z.ZodObject<{
        questions: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;
/**
 * DTO for "update" operation (PATCH-style)
 * All fields optional — Lambdas update only what is provided.
 */
export declare const UpdateKnowledgeBaseSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type UpdateKnowledgeBaseDTO = z.infer<typeof UpdateKnowledgeBaseSchema>;

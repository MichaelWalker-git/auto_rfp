import { z } from 'zod';
export declare const DocumentItemSchema: z.ZodObject<{
    partition_key: z.ZodLiteral<"DOCUMENT">;
    sort_key: z.ZodString;
    id: z.ZodString;
    knowledgeBaseId: z.ZodString;
    name: z.ZodString;
    fileKey: z.ZodString;
    textFileKey: z.ZodString;
    indexStatus: z.ZodEnum<{
        pending: "pending";
        processing: "processing";
        ready: "ready";
        failed: "failed";
    }>;
    indexVectorKey: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type DocumentItem = z.infer<typeof DocumentItemSchema>;
export declare const CreateDocumentDTOSchema: z.ZodObject<{
    knowledgeBaseId: z.ZodString;
    name: z.ZodString;
    fileKey: z.ZodString;
    textFileKey: z.ZodString;
}, z.core.$strip>;
export type CreateDocumentDTO = z.infer<typeof CreateDocumentDTOSchema>;
export declare const UpdateDocumentDTOSchema: z.ZodObject<{
    id: z.ZodString;
    knowledgeBaseId: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    indexStatus: z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        processing: "processing";
        ready: "ready";
        failed: "failed";
    }>>;
    indexVectorKey: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type UpdateDocumentDTO = z.infer<typeof UpdateDocumentDTOSchema>;
export declare const DeleteDocumentDTOSchema: z.ZodObject<{
    id: z.ZodString;
    knowledgeBaseId: z.ZodString;
}, z.core.$strip>;
export type DeleteDocumentDTO = z.infer<typeof DeleteDocumentDTOSchema>;

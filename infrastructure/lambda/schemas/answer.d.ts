import { z } from 'zod';
export declare const AnswerItemSchema: z.ZodObject<{
    id: z.ZodString;
    questionId: z.ZodString;
    projectId: z.ZodOptional<z.ZodString>;
    organizationId: z.ZodOptional<z.ZodString>;
    text: z.ZodString;
    source: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type AnswerItem = z.infer<typeof AnswerItemSchema>;
export declare const CreateAnswerDTOSchema: z.ZodObject<{
    questionId: z.ZodString;
    text: z.ZodString;
    projectId: z.ZodOptional<z.ZodString>;
    organizationId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CreateAnswerDTO = z.infer<typeof CreateAnswerDTOSchema>;

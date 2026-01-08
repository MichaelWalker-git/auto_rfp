import { Context } from 'aws-lambda';
interface ProcessEvent {
    documentId?: string;
    jobId?: string;
    knowledgeBaseId?: string;
}
export declare const handler: (event: ProcessEvent, _context: Context) => Promise<{
    status: string;
}>;
export {};

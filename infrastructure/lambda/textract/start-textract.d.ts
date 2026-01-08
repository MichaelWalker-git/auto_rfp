import { Context } from 'aws-lambda';
interface StartTextractEvent {
    documentId?: string;
    taskToken?: string;
}
interface StartTextractResult {
    jobId: string;
    documentId: string;
    knowledgeBaseId?: string;
    status: 'STARTED';
}
export declare const handler: (event: StartTextractEvent, _context: Context) => Promise<StartTextractResult>;
export {};

import { Context } from 'aws-lambda';
interface Event {
    questionFileId?: string;
    projectId?: string;
    jobId?: string;
}
export declare const handler: (event: Event, _ctx: Context) => Promise<{
    questionFileId: string;
    projectId: string;
    textFileKey: string;
}>;
export {};

import { Context } from 'aws-lambda';
interface Event {
    questionFileId?: string;
    projectId?: string;
    textFileKey?: string;
}
export declare const handler: (event: Event, _ctx: Context) => Promise<{
    count: number;
}>;
export {};

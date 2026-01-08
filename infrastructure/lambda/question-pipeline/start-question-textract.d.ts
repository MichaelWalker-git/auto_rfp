interface StartEvent {
    questionFileId: string;
    projectId: string;
    taskToken?: string;
}
export declare const handler: (event: StartEvent) => Promise<{
    jobId: string;
}>;
export {};

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
export declare function getEmbedding(bedrockClient: BedrockRuntimeClient, modelId: string, text: string): Promise<number[]>;

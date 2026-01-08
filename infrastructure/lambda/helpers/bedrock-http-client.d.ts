import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
/**
 * Invoke Bedrock model - uses API key if available, falls back to SDK
 */
export declare function invokeModel(modelId: string, body: string, contentType?: string, accept?: string): Promise<Uint8Array>;
/**
 * Create a Bedrock client that uses API key authentication
 * This maintains API compatibility with existing code
 */
export declare function createBedrockClient(): BedrockRuntimeClient;

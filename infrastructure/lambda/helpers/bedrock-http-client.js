"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.invokeModel = invokeModel;
exports.createBedrockClient = createBedrockClient;
const client_ssm_1 = require("@aws-sdk/client-ssm");
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const https_1 = __importDefault(require("https"));
const SSM_PARAM_NAME = process.env.BEDROCK_API_KEY_SSM_PARAM || '/auto-rfp/bedrock/api-key';
const BEDROCK_REGION = process.env.BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1';
// Cache for API key to avoid repeated SSM calls in warm Lambda containers
let cachedApiKey = null;
let sdkClient = null;
/**
 * Get the Bedrock API key from SSM Parameter Store with caching
 */
async function getApiKey() {
    if (cachedApiKey) {
        return cachedApiKey;
    }
    try {
        const ssmClient = new client_ssm_1.SSMClient({ region: BEDROCK_REGION });
        const response = await ssmClient.send(new client_ssm_1.GetParameterCommand({
            Name: SSM_PARAM_NAME,
            WithDecryption: true,
        }));
        if (response.Parameter?.Value) {
            cachedApiKey = response.Parameter.Value;
            console.log('Successfully retrieved Bedrock API key from SSM');
            return cachedApiKey;
        }
    }
    catch (error) {
        console.warn('Failed to retrieve Bedrock API key from SSM:', error);
    }
    return null;
}
/**
 * Get or create SDK client for fallback
 */
function getSdkClient() {
    if (!sdkClient) {
        sdkClient = new client_bedrock_runtime_1.BedrockRuntimeClient({ region: BEDROCK_REGION });
    }
    return sdkClient;
}
/**
 * Invoke Bedrock model using HTTP request with Bearer token
 */
async function invokeModelWithHttp(modelId, body, apiKey) {
    const hostname = `bedrock-runtime.${BEDROCK_REGION}.amazonaws.com`;
    const path = `/model/${modelId}/invoke`;
    const options = {
        hostname,
        port: 443,
        path,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Authorization': `Bearer ${apiKey}`,
        },
    };
    return new Promise((resolve, reject) => {
        const req = https_1.default.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => {
                chunks.push(chunk);
            });
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(new Uint8Array(buffer));
                }
                else {
                    const errorMessage = buffer.toString('utf-8');
                    reject(new Error(`Bedrock HTTP request failed: ${res.statusCode} ${res.statusMessage} - ${errorMessage}`));
                }
            });
        });
        req.on('error', (error) => {
            reject(error);
        });
        req.write(body);
        req.end();
    });
}
/**
 * Invoke Bedrock model - uses API key if available, falls back to SDK
 */
async function invokeModel(modelId, body, contentType = 'application/json', accept = 'application/json') {
    // Try to get API key
    const apiKey = await getApiKey();
    if (apiKey) {
        // Use HTTP request with Bearer token
        try {
            console.log(`Invoking Bedrock model ${modelId} with API key authentication`);
            return await invokeModelWithHttp(modelId, body, apiKey);
        }
        catch (error) {
            console.error('Failed to invoke model with API key, falling back to SDK:', error);
            // Fall through to SDK fallback
        }
    }
    // Fallback to SDK
    console.log(`Invoking Bedrock model ${modelId} with SDK authentication`);
    const client = getSdkClient();
    const command = new client_bedrock_runtime_1.InvokeModelCommand({
        modelId,
        contentType,
        accept,
        body: Buffer.from(body),
    });
    const response = await client.send(command);
    if (!response.body) {
        throw new Error('Empty response body from Bedrock');
    }
    return response.body;
}
/**
 * Create a Bedrock client that uses API key authentication
 * This maintains API compatibility with existing code
 */
function createBedrockClient() {
    // Return the SDK client for backward compatibility
    // The invokeModel function will handle API key logic
    return getSdkClient();
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmVkcm9jay1odHRwLWNsaWVudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImJlZHJvY2staHR0cC1jbGllbnQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUE2R0Esa0NBcUNDO0FBTUQsa0RBSUM7QUE1SkQsb0RBQXFFO0FBQ3JFLDRFQUEyRjtBQUMzRixrREFBMEI7QUFFMUIsTUFBTSxjQUFjLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5QkFBeUIsSUFBSSwyQkFBMkIsQ0FBQztBQUM1RixNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxXQUFXLENBQUM7QUFFM0YsMEVBQTBFO0FBQzFFLElBQUksWUFBWSxHQUFrQixJQUFJLENBQUM7QUFDdkMsSUFBSSxTQUFTLEdBQWdDLElBQUksQ0FBQztBQUVsRDs7R0FFRztBQUNILEtBQUssVUFBVSxTQUFTO0lBQ3RCLElBQUksWUFBWSxFQUFFLENBQUM7UUFDakIsT0FBTyxZQUFZLENBQUM7SUFDdEIsQ0FBQztJQUVELElBQUksQ0FBQztRQUNILE1BQU0sU0FBUyxHQUFHLElBQUksc0JBQVMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxjQUFjLEVBQUUsQ0FBQyxDQUFDO1FBQzVELE1BQU0sUUFBUSxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FDbkMsSUFBSSxnQ0FBbUIsQ0FBQztZQUN0QixJQUFJLEVBQUUsY0FBYztZQUNwQixjQUFjLEVBQUUsSUFBSTtTQUNyQixDQUFDLENBQ0gsQ0FBQztRQUVGLElBQUksUUFBUSxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsQ0FBQztZQUM5QixZQUFZLEdBQUcsUUFBUSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUM7WUFDeEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpREFBaUQsQ0FBQyxDQUFDO1lBQy9ELE9BQU8sWUFBWSxDQUFDO1FBQ3RCLENBQUM7SUFDSCxDQUFD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Q3JDLElBQUksQ0FBQztZQUNILE9BQU8sQ0FBQyxHQUFHLENBQUMsMEJBQTBCLE9BQU8sOEJBQThCLENBQUMsQ0FBQztZQUM3RSxPQUFPLE1BQU0sbUJBQW1CLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztRQUMxRCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsMkRBQTJELEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDbEYsK0JBQStCO1FBQ2pDLENBQUM7SUFDSCxDQUFDO0lBRUQsa0JBQWtCO0lBQ2xCLE9BQU8sQ0FBQyxHQUFHLENBQUMsMEJBQTBCLE9BQU8sMEJBQTBCLENBQUMsQ0FBQztJQUN6RSxNQUFNLE1BQU0sR0FBRyxZQUFZLEVBQUUsQ0FBQztJQUM5QixNQUFNLE9BQU8sR0FBRyxJQUFJLDJDQUFrQixDQUFDO1FBQ3JDLE9BQU87UUFDUCxXQUFXO1FBQ1gsTUFBTTtRQUNOLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztLQUN4QixDQUFDLENBQUM7SUFFSCxNQUFNLFFBQVEsR0FBRyxNQUFNLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7SUFFNUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNuQixNQUFNLElBQUksS0FBSyxDQUFDLGtDQUFrQyxDQUFDLENBQUM7SUFDdEQsQ0FBQztJQUVELE9BQU8sUUFBUSxDQUFDLElBQUksQ0FBQztBQUN2QixDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBZ0IsbUJBQW1CO0lBQ2pDLG1EQUFtRDtJQUNuRCxxREFBcUQ7SUFDckQsT0FBTyxZQUFZLEVBQUUsQ0FBQztBQUN4QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU1NNQ2xpZW50LCBHZXRQYXJhbWV0ZXJDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNzbSc7XG5pbXBvcnQgeyBCZWRyb2NrUnVudGltZUNsaWVudCwgSW52b2tlTW9kZWxDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWJlZHJvY2stcnVudGltZSc7XG5pbXBvcnQgaHR0cHMgZnJvbSAnaHR0cHMnO1xuXG5jb25zdCBTU01fUEFSQU1fTkFNRSA9IHByb2Nlc3MuZW52LkJFRFJPQ0tfQVBJX0tFWV9TU01fUEFSQU0gfHwgJy9hdXRvLXJmcC9iZWRyb2NrL2FwaS1rZXknO1xuY29uc3QgQkVEUk9DS19SRUdJT04gPSBwcm9jZXNzLmVudi5CRURST0NLX1JFR0lPTiB8fCBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnO1xuXG4vLyBDYWNoZSBmb3IgQVBJIGtleSB0byBhdm9pZCByZXBlYXRlZCBTU00gY2FsbHMgaW4gd2FybSBMYW1iZGEgY29udGFpbmVyc1xubGV0IGNhY2hlZEFwaUtleTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG5sZXQgc2RrQ2xpZW50OiBCZWRyb2NrUnVudGltZUNsaWVudCB8IG51bGwgPSBudWxsO1xuXG4vKipcbiAqIEdldCB0aGUgQmVkcm9jayBBUEkga2V5IGZyb20gU1NNIFBhcmFtZXRlciBTdG9yZSB3aXRoIGNhY2hpbmdcbiAqL1xuYXN5bmMgZnVuY3Rpb24gZ2V0QXBpS2V5KCk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICBpZiAoY2FjaGVkQXBpS2V5KSB7XG4gICAgcmV0dXJuIGNhY2hlZEFwaUtleTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3Qgc3NtQ2xpZW50ID0gbmV3IFNTTUNsaWVudCh7IHJlZ2lvbjogQkVEUk9DS19SRUdJT04gfSk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBzc21DbGllbnQuc2VuZChcbiAgICAgIG5ldyBHZXRQYXJhbWV0ZXJDb21tYW5kKHtcbiAgICAgICAgTmFtZTogU1NNX1BBUkFNX05BTUUsXG4gICAgICAgIFdpdGhEZWNyeXB0aW9uOiB0cnVlLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgaWYgKHJlc3BvbnNlLlBhcmFtZXRlcj8uVmFsdWUpIHtcbiAgICAgIGNhY2hlZEFwaUtleSA9IHJlc3BvbnNlLlBhcmFtZXRlci5WYWx1ZTtcbiAgICAgIGNvbnNvbGUubG9nKCdTdWNjZXNzZnVsbHkgcmV0cmlldmVkIEJlZHJvY2sgQVBJIGtleSBmcm9tIFNTTScpO1xuICAgICAgcmV0dXJuIGNhY2hlZEFwaUtleTtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS53YXJuKCdGYWlsZWQgdG8gcmV0cmlldmUgQmVkcm9jayBBUEkga2V5IGZyb20gU1NNOicsIGVycm9yKTtcbiAgfVxuXG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIEdldCBvciBjcmVhdGUgU0RLIGNsaWVudCBmb3IgZmFsbGJhY2tcbiAqL1xuZnVuY3Rpb24gZ2V0U2RrQ2xpZW50KCk6IEJlZHJvY2tSdW50aW1lQ2xpZW50IHtcbiAgaWYgKCFzZGtDbGllbnQpIHtcbiAgICBzZGtDbGllbnQgPSBuZXcgQmVkcm9ja1J1bnRpbWVDbGllbnQoeyByZWdpb246IEJFRFJPQ0tfUkVHSU9OIH0pO1xuICB9XG4gIHJldHVybiBzZGtDbGllbnQ7XG59XG5cbi8qKlxuICogSW52b2tlIEJlZHJvY2sgbW9kZWwgdXNpbmcgSFRUUCByZXF1ZXN0IHdpdGggQmVhcmVyIHRva2VuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGludm9rZU1vZGVsV2l0aEh0dHAoXG4gIG1vZGVsSWQ6IHN0cmluZyxcbiAgYm9keTogc3RyaW5nLFxuICBhcGlLZXk6IHN0cmluZ1xuKTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gIGNvbnN0IGhvc3RuYW1lID0gYGJlZHJvY2stcnVudGltZS4ke0JFRFJPQ0tfUkVHSU9OfS5hbWF6b25hd3MuY29tYDtcbiAgY29uc3QgcGF0aCA9IGAvbW9kZWwvJHttb2RlbElkfS9pbnZva2VgO1xuXG4gIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgaG9zdG5hbWUsXG4gICAgcG9ydDogNDQzLFxuICAgIHBhdGgsXG4gICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICdDb250ZW50LUxlbmd0aCc6IEJ1ZmZlci5ieXRlTGVuZ3RoKGJvZHkpLFxuICAgICAgJ0F1dGhvcml6YXRpb24nOiBgQmVhcmVyICR7YXBpS2V5fWAsXG4gICAgfSxcbiAgfTtcblxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IHJlcSA9IGh0dHBzLnJlcXVlc3Qob3B0aW9ucywgKHJlcykgPT4ge1xuICAgICAgY29uc3QgY2h1bmtzOiBCdWZmZXJbXSA9IFtdO1xuXG4gICAgICByZXMub24oJ2RhdGEnLCAoY2h1bms6IEJ1ZmZlcikgPT4ge1xuICAgICAgICBjaHVua3MucHVzaChjaHVuayk7XG4gICAgICB9KTtcblxuICAgICAgcmVzLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGJ1ZmZlciA9IEJ1ZmZlci5jb25jYXQoY2h1bmtzKTtcblxuICAgICAgICBpZiAocmVzLnN0YXR1c0NvZGUgJiYgcmVzLnN0YXR1c0NvZGUgPj0gMjAwICYmIHJlcy5zdGF0dXNDb2RlIDwgMzAwKSB7XG4gICAgICAgICAgcmVzb2x2ZShuZXcgVWludDhBcnJheShidWZmZXIpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBidWZmZXIudG9TdHJpbmcoJ3V0Zi04Jyk7XG4gICAgICAgICAgcmVqZWN0KFxuICAgICAgICAgICAgbmV3IEVycm9yKFxuICAgICAgICAgICAgICBgQmVkcm9jayBIVFRQIHJlcXVlc3QgZmFpbGVkOiAke3Jlcy5zdGF0dXNDb2RlfSAke3Jlcy5zdGF0dXNNZXNzYWdlfSAtICR7ZXJyb3JNZXNzYWdlfWBcbiAgICAgICAgICAgIClcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIHJlcS5vbignZXJyb3InLCAoZXJyb3IpID0+IHtcbiAgICAgIHJlamVjdChlcnJvcik7XG4gICAgfSk7XG5cbiAgICByZXEud3JpdGUoYm9keSk7XG4gICAgcmVxLmVuZCgpO1xuICB9KTtcbn1cblxuLyoqXG4gKiBJbnZva2UgQmVkcm9jayBtb2RlbCAtIHVzZXMgQVBJIGtleSBpZiBhdmFpbGFibGUsIGZhbGxzIGJhY2sgdG8gU0RLXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBpbnZva2VNb2RlbChcbiAgbW9kZWxJZDogc3RyaW5nLFxuICBib2R5OiBzdHJpbmcsXG4gIGNvbnRlbnRUeXBlOiBzdHJpbmcgPSAnYXBwbGljYXRpb24vanNvbicsXG4gIGFjY2VwdDogc3RyaW5nID0gJ2FwcGxpY2F0aW9uL2pzb24nXG4pOiBQcm9taXNlPFVpbnQ4QXJyYXk+IHtcbiAgLy8gVHJ5IHRvIGdldCBBUEkga2V5XG4gIGNvbnN0IGFwaUtleSA9IGF3YWl0IGdldEFwaUtleSgpO1xuXG4gIGlmIChhcGlLZXkpIHtcbiAgICAvLyBVc2UgSFRUUCByZXF1ZXN0IHdpdGggQmVhcmVyIHRva2VuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnNvbGUubG9nKGBJbnZva2luZyBCZWRyb2NrIG1vZGVsICR7bW9kZWxJZH0gd2l0aCBBUEkga2V5IGF1dGhlbnRpY2F0aW9uYCk7XG4gICAgICByZXR1cm4gYXdhaXQgaW52b2tlTW9kZWxXaXRoSHR0cChtb2RlbElkLCBib2R5LCBhcGlLZXkpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gaW52b2tlIG1vZGVsIHdpdGggQVBJIGtleSwgZmFsbGluZyBiYWNrIHRvIFNESzonLCBlcnJvcik7XG4gICAgICAvLyBGYWxsIHRocm91Z2ggdG8gU0RLIGZhbGxiYWNrXG4gICAgfVxuICB9XG5cbiAgLy8gRmFsbGJhY2sgdG8gU0RLXG4gIGNvbnNvbGUubG9nKGBJbnZva2luZyBCZWRyb2NrIG1vZGVsICR7bW9kZWxJZH0gd2l0aCBTREsgYXV0aGVudGljYXRpb25gKTtcbiAgY29uc3QgY2xpZW50ID0gZ2V0U2RrQ2xpZW50KCk7XG4gIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlTW9kZWxDb21tYW5kKHtcbiAgICBtb2RlbElkLFxuICAgIGNvbnRlbnRUeXBlLFxuICAgIGFjY2VwdCxcbiAgICBib2R5OiBCdWZmZXIuZnJvbShib2R5KSxcbiAgfSk7XG5cbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjbGllbnQuc2VuZChjb21tYW5kKTtcbiAgXG4gIGlmICghcmVzcG9uc2UuYm9keSkge1xuICAgIHRocm93IG5ldyBFcnJvcignRW1wdHkgcmVzcG9uc2UgYm9keSBmcm9tIEJlZHJvY2snKTtcbiAgfVxuXG4gIHJldHVybiByZXNwb25zZS5ib2R5O1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIEJlZHJvY2sgY2xpZW50IHRoYXQgdXNlcyBBUEkga2V5IGF1dGhlbnRpY2F0aW9uXG4gKiBUaGlzIG1haW50YWlucyBBUEkgY29tcGF0aWJpbGl0eSB3aXRoIGV4aXN0aW5nIGNvZGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUJlZHJvY2tDbGllbnQoKTogQmVkcm9ja1J1bnRpbWVDbGllbnQge1xuICAvLyBSZXR1cm4gdGhlIFNESyBjbGllbnQgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgLy8gVGhlIGludm9rZU1vZGVsIGZ1bmN0aW9uIHdpbGwgaGFuZGxlIEFQSSBrZXkgbG9naWNcbiAgcmV0dXJuIGdldFNka0NsaWVudCgpO1xufSJdfQ==
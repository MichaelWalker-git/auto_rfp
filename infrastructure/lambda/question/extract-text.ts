import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { apiResponse } from '../helpers/api';

const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET_NAME = process.env.DOCUMENTS_BUCKET;

if (!BUCKET_NAME) {
  throw new Error('DOCUMENTS_BUCKET environment variable is not set');
}

const s3Client = new S3Client({ region: REGION });

interface ExtractTextRequestBody {
  s3Key?: string;
}

/**
 * Read an S3 object and return its content as UTF-8 string.
 */
async function getObjectAsString(bucket: string, key: string): Promise<string> {
  const res = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  if (!res.Body) {
    throw new Error('Empty S3 object body');
  }

  const body: any = res.Body;

  // In AWS SDK v3 on Node.js, Body often has transformToString()
  if (typeof body.transformToString === 'function') {
    return await body.transformToString();
  }

  // Fallback: manual stream handling
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    body.on('data', (chunk: Buffer) => chunks.push(chunk));
    body.on('error', reject);
    body.on('end', () =>
      resolve(Buffer.concat(chunks).toString('utf-8')),
    );
  });
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    // Support HTTP API v2 (requestContext.http.method) and REST (httpMethod) just in case
    const method =
      event.requestContext.http?.method ??
      (event as any).httpMethod;

    if (method !== 'POST') {
      return apiResponse(405, {
        message: 'Method Not Allowed. Use POST.',
      });
    }

    if (!event.body) {
      return apiResponse(400, {
        message: 'Request body is required',
      });
    }

    // Handle potential base64-encoded body (HTTP API can do this)
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;

    let body: ExtractTextRequestBody;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return apiResponse(400, {
        message: 'Invalid JSON in request body',
      });
    }

    const { s3Key } = body;

    if (!s3Key) {
      return apiResponse(400, {
        message: "'s3Key' is required in the request body",
      });
    }

    let content: string;
    try {
      content = await getObjectAsString(BUCKET_NAME, s3Key);
    } catch (err) {
      console.error(`Failed to read S3 object ${BUCKET_NAME}/${s3Key}:`, err);
      return apiResponse(500, {
        message: 'Failed to read document from S3',
      });
    }

    if (!content) {
      return apiResponse(400, {
        message: 'Document content is empty',
      });
    }

    // Main output: plain text content
    return apiResponse(200, {
      content,
      bucket: BUCKET_NAME,
      key: s3Key,
      metadata: {
        wordCount: wordCount(content),
      }
    });
  } catch (error) {
    console.error('Error in extract-text handler:', error);
    return apiResponse(500, {
      message: 'Failed to extract text',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};


function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}
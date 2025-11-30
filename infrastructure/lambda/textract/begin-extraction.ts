import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { StartDocumentTextDetectionCommand, TextractClient, } from '@aws-sdk/client-textract';
import { apiResponse } from '../helpers/api';

const REGION = process.env.AWS_REGION || 'us-east-1';
const DEFAULT_BUCKET = process.env.DOCUMENTS_BUCKET;

if (!DEFAULT_BUCKET) {
  throw new Error('DOCUMENTS_BUCKET environment variable is not set');
}

const textractClient = new TextractClient({ region: REGION });

interface StartExtractionRequestBody {
  s3Key?: string;
  s3Bucket?: string; // optional, defaults to DOCUMENTS_BUCKET
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;

    let body: StartExtractionRequestBody;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    const { s3Key, s3Bucket } = body;

    if (!s3Key) {
      return apiResponse(400, {
        message: "'s3Key' is required in the request body",
      });
    }

    const bucketToUse = s3Bucket || DEFAULT_BUCKET;

    // Start Textract async text detection job
    const startRes = await textractClient.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: {
          S3Object: {
            Bucket: bucketToUse,
            Name: s3Key,
          },
        },
      }),
    );

    const jobId = startRes.JobId;
    if (!jobId) {
      return apiResponse(500, {
        message: 'Textract did not return a JobId',
      });
    }

    return apiResponse(200, {
      jobId,
      s3Key,
      s3Bucket: bucketToUse,
    });
  } catch (error) {
    console.error('Error in start-text-extraction handler:', error);
    return apiResponse(500, {
      message: 'Failed to start text extraction',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

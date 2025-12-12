import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { Block, GetDocumentTextDetectionCommand, TextractClient, } from '@aws-sdk/client-textract';
import { PutObjectCommand, S3Client, } from '@aws-sdk/client-s3';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

const REGION = process.env.AWS_REGION || 'us-east-1';
const DEFAULT_BUCKET = process.env.DOCUMENTS_BUCKET;

if (!DEFAULT_BUCKET) {
  throw new Error('DOCUMENTS_BUCKET environment variable is not set');
}

const textractClient = new TextractClient({ region: REGION });
const s3Client = new S3Client({ region: REGION });

interface CheckExtractionRequestBody {
  jobId?: string;
  s3Key?: string;
  s3Bucket?: string; // optional, defaults to DOCUMENTS_BUCKET
}

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;

    let body: CheckExtractionRequestBody;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    const { jobId, s3Key, s3Bucket } = body;

    if (!jobId) {
      return apiResponse(400, { message: "'jobId' is required in the request body" });
    }

    if (!s3Key) {
      return apiResponse(400, { message: "'s3Key' is required in the request body" });
    }

    const bucketToUse = s3Bucket || DEFAULT_BUCKET;

    // 1) Call Textract once to check current status
    const textractResp = await textractClient.send(
      new GetDocumentTextDetectionCommand({ JobId: jobId }),
    );

    const status = textractResp.JobStatus || 'UNKNOWN';

    // Still running → nothing to build, just tell caller to poll again
    if (status === 'IN_PROGRESS' || status === 'PARTIAL_SUCCESS') {
      return apiResponse(200, {
        status,
        jobId,
      });
    }

    // Failed → bubble error
    if (status === 'FAILED') {
      return apiResponse(500, {
        status,
        jobId,
        message: textractResp.StatusMessage || 'Textract job failed',
      });
    }

    if (status !== 'SUCCEEDED') {
      // Something unexpected like UNKNOWN
      return apiResponse(500, {
        status,
        jobId,
        message: `Unexpected Textract status: ${status}`,
      });
    }

    // 2) SUCCEEDED → collect all pages and flatten lines into text
    const allBlocks: Block[] = [];
    if (textractResp.Blocks) {
      allBlocks.push(...textractResp.Blocks);
    }

    let nextToken = textractResp.NextToken;
    while (nextToken) {
      const page = await textractClient.send(
        new GetDocumentTextDetectionCommand({
          JobId: jobId,
          NextToken: nextToken,
        }),
      );

      if (page.Blocks) {
        allBlocks.push(...page.Blocks);
      }
      nextToken = page.NextToken;
    }

    const text = buildTextFromBlocks(allBlocks);

    if (!text.trim()) {
      return apiResponse(400, {
        status: 'SUCCEEDED',
        jobId,
        message: 'Textract job succeeded but extracted text is empty',
      });
    }

    // 3) Build txt key next to original
    const txtKey = buildTxtKey(s3Key);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketToUse,
        Key: txtKey,
        Body: Buffer.from(text, 'utf-8'),
        ContentType: 'text/plain; charset=utf-8',
      }),
    );

    // 4) Return what caller really needs
    return apiResponse(200, {
      status: 'SUCCEEDED',
      jobId,
      bucket: bucketToUse,
      txtKey,
      textLength: text.length,
    });
  } catch (error) {
    console.error('Error in check-text-extraction handler:', error);
    return apiResponse(500, {
      message: 'Failed to check text extraction status',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

function buildTxtKey(originalKey: string): string {
  const idx = originalKey.lastIndexOf('.');
  if (idx === -1) {
    return `${originalKey}.txt`;
  }
  return `${originalKey.slice(0, idx)}.txt`;
}

function buildTextFromBlocks(blocks: Block[]): string {
  const lines = blocks
    .filter((b) => b.BlockType === 'LINE' && b.Text)
    .map((b) => b.Text!.trim());

  return lines.join('\n');
}


export const handler = withSentryLambda(baseHandler);
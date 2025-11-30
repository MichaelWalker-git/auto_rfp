import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  TextractClient,
  StartDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommand,
  Block,
} from '@aws-sdk/client-textract';
import { apiResponse } from '../helpers/api';

const REGION = process.env.AWS_REGION || 'us-east-1';
const DEFAULT_BUCKET = process.env.DOCUMENTS_BUCKET;

if (!DEFAULT_BUCKET) {
  throw new Error('DOCUMENTS_BUCKET environment variable is not set');
}

const s3Client = new S3Client({ region: REGION });
const textractClient = new TextractClient({ region: REGION });

interface NormalizeRequestBody {
  s3Key?: string;
  s3Bucket?: string; // optional, falls back to DOCUMENTS_BUCKET
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, {
        message: 'Request body is required',
      });
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;

    let body: NormalizeRequestBody;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return apiResponse(400, {
        message: 'Invalid JSON in request body',
      });
    }

    const { s3Key, s3Bucket } = body;

    if (!s3Key) {
      return apiResponse(400, {
        message: "'s3Key' is required in the request body",
      });
    }

    const bucketToUse = s3Bucket || DEFAULT_BUCKET;

    // 1) Load original file from S3 (still useful for non-PDF types)
    const fileBuffer = await getObjectAsBuffer(bucketToUse, s3Key);

    // 2) Detect extension
    const ext = getExtension(s3Key);

    // 3) Extract text based on type
    const text = await extractTextByExtension(ext, fileBuffer, bucketToUse, s3Key);

    if (!text || !text.trim()) {
      return apiResponse(400, {
        message: 'Extracted text is empty',
      });
    }

    // 4) Build output key (same path, .txt extension)
    const outputKey = buildTxtKey(s3Key);

    // 5) Store .txt file to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketToUse,
        Key: outputKey,
        Body: Buffer.from(text, 'utf-8'),
        ContentType: 'text/plain; charset=utf-8',
      }),
    );

    // 6) Return new key
    return apiResponse(200, {
      inputKey: s3Key,
      outputKey,
      bucket: bucketToUse,
    });
  } catch (error) {
    console.error('Error in normalize-to-text handler:', error);
    return apiResponse(500, {
      message: 'Failed to normalize document to text',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Read an S3 object and return its content as Buffer.
 */
async function getObjectAsBuffer(
  bucket: string,
  key: string,
): Promise<Buffer> {
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

  if (typeof body.transformToByteArray === 'function') {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    body.on('data', (chunk: Buffer) => chunks.push(chunk));
    body.on('error', reject);
    body.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Extract file extension from key.
 */
function getExtension(key: string): string {
  const idx = key.lastIndexOf('.');
  if (idx === -1) return '';
  return key.slice(idx + 1).toLowerCase();
}

/**
 * Build txt output key next to original.
 * e.g. "folder/doc.pdf" -> "folder/doc.txt"
 */
function buildTxtKey(originalKey: string): string {
  const idx = originalKey.lastIndexOf('.');
  if (idx === -1) {
    return `${originalKey}.txt`;
  }
  return `${originalKey.slice(0, idx)}.txt`;
}

/**
 * Route to appropriate transformer based on extension.
 * NOTE: PDFs now use Textract on the S3 object (multi-page-safe),
 * other types keep the simple placeholder logic.
 */
async function extractTextByExtension(
  ext: string,
  buffer: Buffer,
  bucket: string,
  key: string,
): Promise<string> {
  switch (ext) {
    case 'txt':
      return buffer.toString('utf-8');

    case 'csv':
      return extractTextFromCsv(buffer);

    case 'xls':
    case 'xlsx':
      return extractTextFromExcel(buffer);

    case 'pdf':
      // ✅ use Textract async job on the S3 object
      return extractTextFromPdfWithTextract(bucket, key);

    case 'doc':
    case 'docx':
      return extractTextFromWord(buffer);

    default:
      console.warn(
        `Unsupported extension "${ext}", falling back to utf-8 text`,
      );
      return buffer.toString('utf-8');
  }
}

/**
 * CSV → text
 */
function extractTextFromCsv(buffer: Buffer): string {
  return buffer.toString('utf-8');
}

/**
 * Excel → text (placeholder)
 */
function extractTextFromExcel(buffer: Buffer): string {
  return buffer.toString('utf-8');
}

/**
 * Word (doc/docx) → text (placeholder)
 */
function extractTextFromWord(buffer: Buffer): string {
  return buffer.toString('utf-8');
}

/**
 * PDF → text using Amazon Textract async APIs:
 * 1) StartDocumentTextDetection (S3 object)
 * 2) Poll GetDocumentTextDetection until SUCCEEDED
 * 3) Concatenate all LINE blocks into plain text
 */
async function extractTextFromPdfWithTextract(
  bucket: string,
  key: string,
): Promise<string> {
  // 1. Start async job
  const startRes = await textractClient.send(
    new StartDocumentTextDetectionCommand({
      DocumentLocation: {
        S3Object: {
          Bucket: bucket,
          Name: key,
        },
      },
    }),
  );

  const jobId = startRes.JobId;
  if (!jobId) {
    throw new Error('Textract did not return a JobId');
  }

  // 2. Poll until job finishes
  const blocks: Block[] = [];
  let nextToken: string | undefined;
  const maxAttempts = 60; // e.g. up to ~2 minutes with 2s delay
  const delayMs = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await textractClient.send(
      new GetDocumentTextDetectionCommand({
        JobId: jobId,
        NextToken: nextToken,
      }),
    );

    const status = res.JobStatus;
    if (status === 'SUCCEEDED') {
      if (res.Blocks) {
        blocks.push(...res.Blocks);
      }
      if (res.NextToken) {
        nextToken = res.NextToken;
        // More pages – keep looping without waiting
        continue;
      }
      // All pages received
      break;
    }

    if (status === 'FAILED') {
      throw new Error(
        `Textract Job failed for ${bucket}/${key}: ${res.StatusMessage || 'unknown error'}`,
      );
    }

    // IN_PROGRESS / PARTIAL_SUCCESS: wait and poll again
    await sleep(delayMs);
  }

  if (!blocks.length) {
    console.warn(`Textract returned no blocks for ${bucket}/${key}`);
    return '';
  }

  // 3. Glue all LINE texts into one plain-text blob
  const lines = blocks
    .filter((b) => b.BlockType === 'LINE' && b.Text)
    .map((b) => b.Text!.trim());

  return lines.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import {
  TextractClient,
  StartDocumentTextDetectionCommand,
} from '@aws-sdk/client-textract';

import { apiResponse } from '../helpers/api';
import { PK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';

// ---- Config ----

const REGION =
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  'us-east-1';

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;

if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME environment variable is not set');
}
if (!DOCUMENTS_BUCKET) {
  throw new Error('DOCUMENTS_BUCKET environment variable is not set');
}

// singletons
const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({ region: REGION });
const textractClient = new TextractClient({ region: REGION });

// ---- Types ----

interface StartIndexingInput {
  documentId: string;
}

interface ExtractTextResponse_TextReady {
  documentId: string;
  status: 'TEXT_READY';
  text: string;
  textS3Key: string;
}

interface ExtractTextResponse_TextractStarted {
  documentId: string;
  status: 'TEXTRACT_STARTED';
  textractJobId: string;
  s3Object: {
    bucket: string;
    key: string;
  };
}

type ExtractTextResponse =
  | ExtractTextResponse_TextReady
  | ExtractTextResponse_TextractStarted;

// ---- Helpers ----

async function getDocumentById(documentId: string) {
  // We have a single-table with PK = DOCUMENT_PK and SK = `KB#...#DOC#<id>`
  // plus a top-level `id` attribute. We can query the partition and filter
  // by id. (Not perfect, but OK for our case.)
  const cmd = new QueryCommand({
    TableName: DB_TABLE_NAME,
    KeyConditionExpression: '#pk = :pk',
    ExpressionAttributeNames: {
      '#pk': PK_NAME,
    },
    ExpressionAttributeValues: {
      ':pk': DOCUMENT_PK,
    },
    FilterExpression: 'id = :id',
    ExpressionAttributeValuesAdditional: undefined,
  } as any);

  // TypeScript hack because lib-dynamodb doesn't like multiple EAV objects.
  (cmd.input as any).ExpressionAttributeValues[':id'] = documentId;

  const res = await docClient.send(cmd);

  if (!res.Items || res.Items.length === 0) {
    throw new Error(`Document with id=${documentId} not found`);
  }

  return res.Items[0] as {
    id: string;
    fileKey: string;
    knowledgeBaseId?: string;
    [key: string]: any;
  };
}

async function streamToString(
  body: any,
): Promise<string> {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf-8');

  // Node.js SDK v3 stream
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    body.on('data', (chunk: Buffer) => chunks.push(chunk));
    body.on('error', reject);
    body.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function isTextKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.json') ||
    lower.endsWith('.log')
  );
}

// ---- Lambda handler (API-triggered, documentId in body) ----

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Body is required' });
    }

    let body: StartIndexingInput;
    try {
      body = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON body' });
    }

    const { documentId } = body;

    if (!documentId || typeof documentId !== 'string') {
      return apiResponse(400, {
        message: '`documentId` is required and must be a string',
      });
    }

    // 1) Load document from DynamoDB
    const doc = await getDocumentById(documentId);
    const fileKey = doc.fileKey;
    if (!fileKey) {
      return apiResponse(400, {
        message: `Document ${documentId} does not have fileKey`,
      });
    }

    // 2) Decide path based on file extension
    if (isTextKey(fileKey)) {
      // ---- SHORT-CIRCUIT: FILE IS ALREADY TEXT ----
      const getObj = await s3Client.send(
        new GetObjectCommand({
          Bucket: DOCUMENTS_BUCKET,
          Key: fileKey,
        }),
      );

      const text = await streamToString(getObj.Body);

      const response: ExtractTextResponse_TextReady = {
        documentId,
        status: 'TEXT_READY',
        text,
        textS3Key: fileKey,
      };

      return apiResponse(200, response);
    }

    // 3) Non-text file → Start async Textract job and return jobId only.
    //    Step Function will handle waiting / polling in subsequent states.
    const startResp = await textractClient.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: {
          S3Object: {
            Bucket: DOCUMENTS_BUCKET,
            Name: fileKey,
          },
        },
        NotificationChannel: undefined, // you can wire SNS/SQS if you want callback-style
      }),
    );

    if (!startResp.JobId) {
      throw new Error('Textract did not return JobId');
    }

    const response: ExtractTextResponse_TextractStarted = {
      documentId,
      status: 'TEXTRACT_STARTED',
      textractJobId: startResp.JobId,
      s3Object: {
        bucket: DOCUMENTS_BUCKET,
        key: fileKey,
      },
    };

    // NOTE: we do NOT wait/poll here — Step Functions should:
    //   - Wait
    //   - Call a "get-textract-result" lambda with { textractJobId, documentId }
    //   - That lambda will assemble text, upload to S3, and return { text, textS3Key }

    return apiResponse(200, response);
  } catch (err) {
    console.error('Error in extract-text lambda:', err);
    return apiResponse(500, {
      message: 'Failed to start or perform text extraction',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

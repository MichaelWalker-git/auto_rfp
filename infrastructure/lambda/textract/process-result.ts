import { Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, } from '@aws-sdk/lib-dynamodb';
import { GetDocumentTextDetectionCommand, TextractClient, } from '@aws-sdk/client-textract';
import { BedrockRuntimeClient, InvokeModelCommand, } from '@aws-sdk/client-bedrock-runtime';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import https from 'https';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { DocumentItem } from '../schemas/document';
import { withSentryLambda } from '../sentry-lambda';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const textractClient = new TextractClient({});
const s3Client = new S3Client({});

const REGION =
  process.env.REGION ||
  process.env.AWS_REGION ||
  process.env.BEDROCK_REGION ||
  'us-east-1';

const bedrockClient = new BedrockRuntimeClient({
  region: REGION,
});

const DOCUMENTS_TABLE_NAME = process.env.DOCUMENTS_TABLE_NAME;
const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT;
const BEDROCK_MODEL_ID = process.env.BEDROCK_EMBEDDING_MODEL_ID || 'amazon.titan-embed-text-v2:0';
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;

if (!DOCUMENTS_TABLE_NAME) {
  throw new Error('DOCUMENTS_TABLE_NAME env var is not set');
}
if (!OPENSEARCH_ENDPOINT) {
  throw new Error('OPENSEARCH_ENDPOINT env var is not set');
}
if (!DOCUMENTS_BUCKET) {
  throw new Error('TEXT_BUCKET_NAME / DOCUMENTS_BUCKET env var is not set');
}

// --- Types ---
interface ProcessEvent {
  documentId?: string;
  jobId?: string;
  knowledgeBaseId?: string;
}

interface GetTextractResult {
  text: string;
  status: string;
}

// --- Main handler ---
const baseHandler = async (
  event: ProcessEvent,
  _context: Context,
): Promise<{ status: string }> => {
  console.log('process-result event:', JSON.stringify(event));

  const documentId = event.documentId;
  const jobId = event.jobId;
  const knowledgeBaseId = event.knowledgeBaseId;

  if (!documentId || !jobId || !knowledgeBaseId) {
    throw new Error('documentId, jobId and knowledgeBaseId are required');
  }

  // 1) Fetch full text from Textract
  const { text, status } = await getTextractText(jobId);

  if (status !== 'SUCCEEDED') {
    console.warn(`Textract job ${jobId} finished with status=${status}`);
    await updateDocument(documentId, knowledgeBaseId, 'error');
    return { status: 'FAILED' };
  }

  // 2) Generate embeddings with Bedrock
  const embedding = await embedText(text);

  // 3) Index into OpenSearch Serverless (AOSS)
  const indexName = 'documents'; // or `${stage}-documents` etc.

  await indexToOpenSearch(indexName, documentId, {
    documentId,
    text,
    embedding,
  });

  // 3b) Load original document to derive textFileKey path
  const { fileKey } = await getDocument(knowledgeBaseId, documentId);

  const textFileKey = `${jobId}/${documentId}/${fileKey}.txt`;
  console.log('Computed textFileKey:', textFileKey);

  // 3c) Save extracted text to S3
  await saveTextFileToS3(textFileKey, text);

  // 4) Update DynamoDB indexStatus + textFileKey
  await updateDocument(documentId, knowledgeBaseId, 'indexed', textFileKey);

  return { status: 'SUCCEEDED' };
};

// --- Textract helpers ---

async function getTextractText(jobId: string): Promise<GetTextractResult> {
  let nextToken: string | undefined = undefined;
  const lines: string[] = [];
  let jobStatus: string | undefined;

  do {
    const res: any = await textractClient.send(
      new GetDocumentTextDetectionCommand({
        JobId: jobId,
        NextToken: nextToken,
      }),
    );

    jobStatus = res.JobStatus;
    if (!jobStatus) {
      return { text: '', status: 'UNKNOWN' };
    }

    if (jobStatus !== 'SUCCEEDED') {
      // For callback-based pattern we expect only final status here
      return { text: '', status: jobStatus };
    }

    if (res.Blocks) {
      for (const block of res.Blocks) {
        if (block.BlockType === 'LINE' && block.Text) {
          lines.push(block.Text);
        }
      }
    }

    nextToken = res.NextToken;
  } while (nextToken);

  return {
    text: lines.join('\n'),
    status: jobStatus,
  };
}

// --- Bedrock embeddings ---

async function embedText(text: string): Promise<number[]> {
  const payload = {
    inputText: text,
  };

  const res = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify(payload)),
    }),
  );

  if (!res.body) {
    throw new Error('Bedrock returned no body');
  }

  const json = JSON.parse(Buffer.from(res.body).toString('utf-8'));

  // Titan style; adjust if you change model
  const embedding: number[] =
    json.embedding ?? json.vector ?? json.embeddings?.[0];

  if (!embedding) {
    throw new Error(
      `Unexpected embedding response: ${JSON.stringify(json).slice(0, 500)}`,
    );
  }

  return embedding;
}

// --- OpenSearch Serverless (AOSS) indexing ---

async function indexToOpenSearch(
  indexName: string,
  id: string, // kept for logging / body, but not used in path
  body: unknown,
): Promise<void> {
  const endpointUrl = new URL(OPENSEARCH_ENDPOINT!);
  const payload = JSON.stringify(body);

  const request = new HttpRequest({
    method: 'POST', // no ID in path for AOSS index API
    protocol: endpointUrl.protocol,
    hostname: endpointUrl.hostname,
    path: `/${indexName}/_doc`,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload).toString(),
      host: endpointUrl.hostname,
    },
    body: payload,
  });

  const signer = new SignatureV4({
    service: 'aoss',
    region: REGION,
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  const signed = await signer.sign(request);

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        method: signed.method,
        hostname: signed.hostname,
        path: signed.path,
        headers: signed.headers as any,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const bodyStr = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(
              new Error(
                `OpenSearch index error: ${res.statusCode} ${res.statusMessage} - ${bodyStr}`,
              ),
            );
          }
        });
      },
    );

    req.on('error', reject);
    if (signed.body) {
      req.write(signed.body);
    }
    req.end();
  });
}

// --- Dynamo helpers ---

async function getDocument(
  knowledgeBaseId: string,
  documentId: string,
): Promise<DocumentItem & { fileKey?: string; textFileKey?: string }> {
  const sk = `KB#${knowledgeBaseId}#DOC#${documentId}`;

  console.log('getDocument: fetching from Dynamo', {
    table: DOCUMENTS_TABLE_NAME,
    pk: DOCUMENT_PK,
    sk,
  });

  const res = await docClient.send(
    new GetCommand({
      TableName: DOCUMENTS_TABLE_NAME,
      Key: {
        [PK_NAME]: DOCUMENT_PK,
        [SK_NAME]: sk,
      },
    }),
  );

  if (!res.Item) {
    throw new Error(
      `Document not found in DynamoDB for PK=${DOCUMENT_PK}, SK=${sk}`,
    );
  }

  const item = res.Item as DocumentItem & {
    fileKey?: string;
    textFileKey?: string;
  };

  if (!item.fileKey) {
    console.warn(
      `getDocument: item has no fileKey (PK=${DOCUMENT_PK}, SK=${sk})`,
    );
  }

  return item;
}

async function updateDocument(
  documentId: string,
  knowledgeBaseId: string,
  status: 'processing' | 'indexed' | 'error',
  textFileKey?: string,
): Promise<void> {
  const sk = `KB#${knowledgeBaseId}#DOC#${documentId}`;

  const expressionAttributeNames: Record<string, string> = {
    '#indexStatus': 'indexStatus',
    '#updatedAt': 'updatedAt',
  };
  const expressionAttributeValues: Record<string, any> = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
  };

  let updateExpression =
    'SET #indexStatus = :status, #updatedAt = :updatedAt';

  if (textFileKey) {
    expressionAttributeNames['#textFileKey'] = 'textFileKey';
    expressionAttributeValues[':textFileKey'] = textFileKey;
    updateExpression += ', #textFileKey = :textFileKey';
  }

  console.log('updateDocument: updating Dynamo', {
    table: DOCUMENTS_TABLE_NAME,
    pk: DOCUMENT_PK,
    sk,
    status,
    textFileKey,
  });

  await docClient.send(
    new UpdateCommand({
      TableName: DOCUMENTS_TABLE_NAME,
      Key: {
        [PK_NAME]: DOCUMENT_PK,
        [SK_NAME]: sk,
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }),
  );
}

// --- S3 helper ---

async function saveTextFileToS3(
  key: string,
  text: string,
): Promise<void> {
  console.log('saveTextFileToS3:', {
    bucket: DOCUMENTS_BUCKET,
    key,
    textLength: text.length,
  });

  await s3Client.send(
    new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
      Body: text,
      ContentType: 'text/plain; charset=utf-8',
    }),
  );
}

export const handler = withSentryLambda(baseHandler);
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, } from '@aws-sdk/lib-dynamodb';

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import https from 'https';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';

import { DeleteDocumentDTO, DeleteDocumentDTOSchema, } from '../schemas/document';
import { withSentryLambda } from '../sentry-lambda';
import middy from '@middy/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';


const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const DOCUMENTS_BUCKET_NAME =
  process.env.DOCUMENTS_BUCKET ||
  process.env.DOCUMENTS_BUCKET_NAME ||
  process.env.TEXT_BUCKET_NAME;

const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT;
const OPENSEARCH_INDEX = process.env.OPENSEARCH_INDEX || 'documents';
const OPENSEARCH_REGION =
  process.env.OPENSEARCH_REGION ||
  process.env.AWS_REGION ||
  process.env.REGION ||
  'us-east-1';

if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME environment variable is not set');
}
if (!DOCUMENTS_BUCKET_NAME) {
  throw new Error(
    'DOCUMENTS_BUCKET / DOCUMENTS_BUCKET_NAME / TEXT_BUCKET_NAME env var is not set',
  );
}
if (!OPENSEARCH_ENDPOINT) {
  throw new Error('OPENSEARCH_ENDPOINT environment variable is not set');
}

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const s3Client = new S3Client({});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is missing' });
    }

    // Parse JSON
    let json: any;
    try {
      json = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON format' });
    }

    // Validate with Zod
    const parsed = DeleteDocumentDTOSchema.safeParse(json);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return apiResponse(400, {
        message: 'Validation failed',
        errors,
      });
    }

    const dto: DeleteDocumentDTO = parsed.data;

    await deleteDocument(dto);

    return apiResponse(200, {
      success: true,
      id: dto.id,
      knowledgeBaseId: dto.knowledgeBaseId,
    });
  } catch (err) {
    console.error('Error in delete-document handler:', err);

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

// -------------------------------------------------------------
// Core logic: remove document files from S3, delete from OpenSearch,
// then remove record from DynamoDB
// -------------------------------------------------------------
async function deleteDocument(dto: DeleteDocumentDTO): Promise<void> {
  const sk = `KB#${dto.knowledgeBaseId}#DOC#${dto.id}`;

  // 1) Load DB record so we know the file keys
  const getRes = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: DOCUMENT_PK,
        [SK_NAME]: sk,
      },
    }),
  );

  if (!getRes.Item) {
    console.warn(
      `deleteDocument: no document found for PK=${DOCUMENT_PK}, SK=${sk}; nothing to delete`,
    );
  } else {
    const item = getRes.Item as {
      fileKey?: string;
      textFileKey?: string;
    };

    const deletes: Promise<any>[] = [];

    if (item.fileKey) {
      console.log(
        'Deleting original file from S3:',
        DOCUMENTS_BUCKET_NAME,
        item.fileKey,
      );
      deletes.push(
        s3Client.send(
          new DeleteObjectCommand({
            Bucket: DOCUMENTS_BUCKET_NAME,
            Key: item.fileKey,
          }),
        ),
      );
    } else {
      console.log(
        `deleteDocument: no fileKey on item PK=${DOCUMENT_PK}, SK=${sk}`,
      );
    }

    if (item.textFileKey) {
      console.log(
        'Deleting text file from S3:',
        DOCUMENTS_BUCKET_NAME,
        item.textFileKey,
      );
      deletes.push(
        s3Client.send(
          new DeleteObjectCommand({
            Bucket: DOCUMENTS_BUCKET_NAME,
            Key: item.textFileKey,
          }),
        ),
      );
    } else {
      console.log(
        `deleteDocument: no textFileKey on item PK=${DOCUMENT_PK}, SK=${sk}`,
      );
    }

    if (deletes.length > 0) {
      await Promise.all(deletes);
    }
  }

  // 2) Delete from OpenSearch by documentId (delete-by-query)
  try {
    await deleteFromOpenSearch(dto.id);
  } catch (err) {
    console.error(
      `Failed to delete documentId=${dto.id} from OpenSearch index=${OPENSEARCH_INDEX}:`,
      err,
    );
    // depending on how strict you want to be, you can throw here
    // throw err;
  }

  // 3) Delete DynamoDB record
  console.log(
    'Deleting document record from DynamoDB',
    DB_TABLE_NAME,
    DOCUMENT_PK,
    sk,
  );

  await docClient.send(
    new DeleteCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: DOCUMENT_PK,
        [SK_NAME]: sk,
      },
    }),
  );
}

// -------------------------------------------------------------
// OpenSearch delete-by-query helper
// -------------------------------------------------------------
async function deleteFromOpenSearch(documentId: string): Promise<void> {
  // Serverless: _delete_by_query often 404 (unsupported). Use search -> delete.
  const ids = await findOpenSearchIdsByDocumentId(documentId);

  if (!ids.length) {
    console.log(`OpenSearch: no docs found for documentId=${documentId} (nothing to delete)`);
    return;
  }

  // sequential is safest; you can parallelize if needed
  for (const id of ids) {
    await deleteOpenSearchDocById(id);
  }

  console.log(`OpenSearch: deleted ${ids.length} docs for documentId=${documentId}`);
}

async function findOpenSearchIdsByDocumentId(documentId: string): Promise<string[]> {
  const endpointUrl = new URL(OPENSEARCH_ENDPOINT!);

  const body = {
    size: 1000,
    query: { term: { 'documentId.keyword': documentId } },
    _source: false,
  };

  const payload = JSON.stringify(body);

  const request = new HttpRequest({
    method: 'POST',
    protocol: endpointUrl.protocol,
    hostname: endpointUrl.hostname,
    path: `/${OPENSEARCH_INDEX}/_search`,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload).toString(),
      host: endpointUrl.hostname,
    },
    body: payload,
  });

  const signer = new SignatureV4({
    service: 'aoss',
    region: OPENSEARCH_REGION,
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  const signed = await signer.sign(request);

  const raw = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      { method: signed.method, hostname: signed.hostname, path: signed.path, headers: signed.headers as any },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) return resolve(text);
          reject(new Error(`OpenSearch search error: ${res.statusCode} ${res.statusMessage} - ${text}`));
        });
      }
    );
    req.on('error', reject);
    if (signed.body) req.write(signed.body);
    req.end();
  });

  const json = JSON.parse(raw);
  const hits = json?.hits?.hits ?? [];
  return hits.map((h: any) => h._id).filter((id: any) => typeof id === 'string' && id.length > 0);
}


async function deleteOpenSearchDocById(osId: string): Promise<void> {
  const endpointUrl = new URL(OPENSEARCH_ENDPOINT!);

  const request = new HttpRequest({
    method: 'DELETE',
    protocol: endpointUrl.protocol,
    hostname: endpointUrl.hostname,
    path: `/${OPENSEARCH_INDEX}/_doc/${encodeURIComponent(osId)}`,
    headers: { host: endpointUrl.hostname },
  });

  const signer = new SignatureV4({
    service: 'aoss',
    region: OPENSEARCH_REGION,
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  const signed = await signer.sign(request);

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      { method: signed.method, hostname: signed.hostname, path: signed.path, headers: signed.headers as any },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');

          // 404 here means "doc not found" -> already deleted
          if (res.statusCode === 404) return resolve();

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) return resolve();
          reject(new Error(`OpenSearch delete-doc error: ${res.statusCode} ${res.statusMessage} - ${text}`));
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:delete'))
    .use(httpErrorMiddleware())
);

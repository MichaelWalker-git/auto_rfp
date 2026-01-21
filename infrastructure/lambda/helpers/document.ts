import { DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import https from 'https';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';

// -------------------------------------------------------------
// Core logic:
// 1) Load Dynamo record (to obtain S3 keys)
// 2) Delete from OpenSearch FIRST (must succeed)
// 3) Delete Dynamo row only after OpenSearch succeeds
// 4) Delete S3 objects last (strict or best-effort)
// -------------------------------------------------------------
import { DeleteDocumentDTO } from '../schemas/document';
import { requireEnv } from './env';
import { docClient } from './db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const OPENSEARCH_ENDPOINT = requireEnv('OPENSEARCH_ENDPOINT');
const OPENSEARCH_INDEX = requireEnv('OPENSEARCH_INDEX', 'documents');
const OPENSEARCH_REGION = requireEnv('OPENSEARCH_REGION', 'us-east-1');

const s3Client = new S3Client({});

const STRICT_S3_DELETE = false;

export async function deleteDocument(dto: DeleteDocumentDTO): Promise<void> {
  const sk = `KB#${dto.knowledgeBaseId}#DOC#${dto.id}`;

  // 1) Load DB record so we know S3 keys (but don't delete yet)
  const getRes = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: DOCUMENT_PK,
        [SK_NAME]: sk,
      },
    }),
  );

  const item = (getRes.Item ?? {}) as { fileKey?: string; textFileKey?: string };

  // 2) Delete from OpenSearch FIRST (strict)
  await deleteFromOpenSearch(dto.id);

  // 3) Delete DynamoDB record only after OpenSearch succeeds
  console.log('Deleting document record from DynamoDB', DB_TABLE_NAME, DOCUMENT_PK, sk);

  await docClient.send(
    new DeleteCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: DOCUMENT_PK,
        [SK_NAME]: sk,
      },
    }),
  );

  // 4) Delete S3 objects last
  const deletes: Promise<any>[] = [];

  if (item.fileKey) {
    console.log('Deleting original file from S3:', DOCUMENTS_BUCKET, item.fileKey);
    deletes.push(
      s3Client.send(
        new DeleteObjectCommand({
          Bucket: DOCUMENTS_BUCKET,
          Key: item.fileKey,
        }),
      ),
    );
  } else {
    console.log(`deleteDocument: no fileKey on item PK=${DOCUMENT_PK}, SK=${sk}`);
  }

  if (item.textFileKey) {
    console.log('Deleting text file from S3:', DOCUMENTS_BUCKET, item.textFileKey);
    deletes.push(
      s3Client.send(
        new DeleteObjectCommand({
          Bucket: DOCUMENTS_BUCKET,
          Key: item.textFileKey,
        }),
      ),
    );
  } else {
    console.log(`deleteDocument: no textFileKey on item PK=${DOCUMENT_PK}, SK=${sk}`);
  }

  if (deletes.length > 0) {
    if (STRICT_S3_DELETE) {
      await Promise.all(deletes);
    } else {
      const results = await Promise.allSettled(deletes);
      for (const r of results) {
        if (r.status === 'rejected') {
          console.error('S3 delete failed (best-effort):', r.reason);
        }
      }
    }
  }
}

export async function deleteFromOpenSearch(documentId: string): Promise<void> {
  const endpointUrl = new URL(OPENSEARCH_ENDPOINT);

  const body = {
    query: { term: { 'documentId.keyword': documentId } },
  };

  const payload = JSON.stringify(body);

  const request = new HttpRequest({
    method: 'POST',
    protocol: endpointUrl.protocol,
    hostname: endpointUrl.hostname,
    path: `/${OPENSEARCH_INDEX}/_delete_by_query?conflicts=proceed&refresh=true`,
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
      {
        method: signed.method,
        hostname: endpointUrl.hostname,
        port: endpointUrl.port ? Number(endpointUrl.port) : 443,
        path: signed.path,
        headers: signed.headers as any,
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) return resolve(text);
          reject(new Error(`OpenSearch delete_by_query error: ${res.statusCode} ${res.statusMessage} - ${text}`));
        });
      },
    );

    req.on('timeout', () => req.destroy(new Error('OpenSearch delete_by_query timeout')));
    req.on('error', reject);
    if (signed.body) req.write(signed.body);
    req.end();
  });

  try {
    const json = JSON.parse(raw);
    console.log(`OpenSearch: delete_by_query deleted=${json?.deleted ?? 'unknown'} for documentId=${documentId}`);
  } catch {
    console.log(`OpenSearch: delete_by_query ok for documentId=${documentId}`);
  }
}
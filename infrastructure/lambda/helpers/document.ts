import { DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';

// -------------------------------------------------------------
// Core logic:
// 1) Load Dynamo record (to obtain S3 keys)
// 2) Delete Dynamo row
// 3) Delete S3 objects last (strict or best-effort)
// Note: Pinecone deletion is handled separately in delete-document.ts
// -------------------------------------------------------------
import { DeleteDocumentDTO } from '../schemas/document';
import { requireEnv } from './env';
import { docClient } from './db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

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

  // 2) Delete DynamoDB record
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


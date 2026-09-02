import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { DOCUMENT_PK } from '@/constants/document';

import { CreateDocumentDTO, DeleteDocumentDTO, DocumentItem } from '@auto-rfp/core';
import { requireEnv } from './env';
import { createItem, deleteItem, getItem, queryByPkAndSkContains } from './db';
import { deleteFromPinecone } from './pinecone';
import { buildDocumentSK } from 'helpers/document-keys';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const s3Client = new S3Client({});

export async function createDocument(
  dto: CreateDocumentDTO,
  userId: string = 'system',
): Promise<DocumentItem> {
  const docId = uuidv4();
  const { knowledgeBaseId, name, fileKey, textFileKey, fileSize } = dto;

  return await createItem<DocumentItem>(
    DOCUMENT_PK,
    buildDocumentSK(knowledgeBaseId, docId),
    {
      id: docId,
      knowledgeBaseId,
      name,
      fileKey,
      textFileKey,
      indexStatus: 'pending',
      createdBy: userId,
      updatedBy: userId,
      ...(fileSize !== undefined ? { fileSize } : {}),
    } as any
  );
}

export async function deleteDocument(dto: DeleteDocumentDTO): Promise<void> {
  const sk = buildDocumentSK(dto.knowledgeBaseId, dto.id);

  // 1) Load DB record so we know the file keys and chunk count
  const item = await getItem<DocumentItem>(DOCUMENT_PK, sk);

  if (!item) {
    console.warn(`deleteDocument: no document found for PK=${DOCUMENT_PK}, SK=${sk}; attempting best-effort Pinecone cleanup anyway`);
  }

  // 2) Delete from Pinecone first — a failure here must stop the delete so the
  // DDB row (and therefore the document in the KB list) survives for retry.
  await deleteFromPinecone(dto.orgId, sk, {
    chunkCount: item?.chunkCount,
    textFileKey: item?.textFileKey,
  });

  // 3) Delete S3 objects — a failure here must also stop the delete before the
  // DDB row is removed.
  const deletes: Promise<unknown>[] = [];
  if (item?.fileKey) {
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

  if (item?.textFileKey) {
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
    await Promise.all(deletes);
  }

  // 4) Delete DDB row last — this is the commit marker for a successful delete.
  await deleteItem(DOCUMENT_PK, sk);
}

export const getDocumentItemByDocumentId = async (documentId: string): Promise<DocumentItem | undefined> => {
  const res = await queryByPkAndSkContains<DocumentItem>(DOCUMENT_PK, `#DOC#${documentId}`);
  return res[0];
};


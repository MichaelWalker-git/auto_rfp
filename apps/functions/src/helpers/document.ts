import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { DOCUMENT_PK } from '../constants/document';

// -------------------------------------------------------------
// Core logic:
// 1) Load Dynamo record (to obtain S3 keys)
// 2) Delete Dynamo row
// 3) Delete S3 objects last (strict or best-effort)
// Note: Pinecone deletion is handled separately in delete-document.ts
// -------------------------------------------------------------
import { CreateDocumentDTO, DeleteDocumentDTO, DocumentItem } from '@auto-rfp/core';
import { requireEnv } from './env';
import { createItem, deleteItem, getItem, queryByPkAndSkContains } from './db';
import { deleteFromPinecone } from './pinecone';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const s3Client = new S3Client({});

export const buildDocumentSK = (kbId: string, docId: string) => {
  return `KB#${kbId}#DOC#${docId}`
}

export async function createDocument(
  dto: CreateDocumentDTO,
  userId: string = 'system',
): Promise<DocumentItem> {
  const docId = uuidv4();
  const { knowledgeBaseId, name, fileKey, textFileKey } = dto;

  const documentItem = await createItem<DocumentItem>(
    DOCUMENT_PK,
    buildDocumentSK(knowledgeBaseId, docId),
    {
      id: docId,
      knowledgeBaseId,
      name,
      fileKey,
      textFileKey,
      indexStatus: 'pending',
    } as any
  );

  return documentItem;
}

export async function deleteDocument(dto: DeleteDocumentDTO): Promise<void> {
  const sk = buildDocumentSK(dto.knowledgeBaseId, dto.id)

  // 1) Load DB record so we know the file keys
  const item = await getItem<DocumentItem>(DOCUMENT_PK, sk);

  if (!item) {
    console.warn(`deleteDocument: no document found for PK=${DOCUMENT_PK}, SK=${sk}; nothing to delete`,);
  } else {
    const deletes: Promise<any>[] = [];
    if (item.fileKey) {
      console.log(
        'Deleting original file from S3:',
        DOCUMENTS_BUCKET,
        item.fileKey,
      );
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
      console.log('Deleting text file from S3:', DOCUMENTS_BUCKET, item.textFileKey,);
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
  }

  // 2) Delete from Pinecone by documentId
  try {
    await deleteFromPinecone(dto.orgId, sk);
  } catch (err) {
    console.error(`Failed to delete documentId=${dto.id} from Pinecone:`, err);
  }

  await deleteItem(DOCUMENT_PK, sk);
}

export const getDocumentItemByDocumentId = async (documentId: string): Promise<DocumentItem | undefined> => {
  const res = await queryByPkAndSkContains<DocumentItem>(DOCUMENT_PK, `#DOC#${documentId}`);
  return res[0];
};


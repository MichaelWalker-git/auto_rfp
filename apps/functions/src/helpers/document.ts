import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { DOCUMENT_PK } from '@/constants/document';
import { SK_NAME } from '@/constants/common';

import { CreateDocumentDTO, DeleteDocumentDTO, DocumentItem, UpdateDocumentDTO } from '@auto-rfp/core';
import { requireEnv } from './env';
import { createItem, deleteItem, getItem, queryAllBySkPrefix, queryByPkAndSkContains, updateItem } from './db';
import { deleteFromPinecone, updateChunkDocumentNameInPinecone } from './pinecone';
import { enqueueRenameChunksJob } from './rename-chunks-queue';
import { buildDocumentSK } from 'helpers/document-keys';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const s3Client = new S3Client({});

/** A document with this (case-insensitive) name already exists in the KB. */
export class DuplicateDocumentNameError extends Error {
  constructor() {
    super('A document with this name already exists in this knowledge base.');
    this.name = 'DuplicateDocumentNameError';
  }
}

/** The document being updated no longer exists. */
export class DocumentNotFoundError extends Error {
  constructor() {
    super('Document not found');
    this.name = 'DocumentNotFoundError';
  }
}

// Inline Pinecone chunk-metadata propagation is only attempted for documents at
// or under this size; larger documents enqueue the async rename-chunks worker
// (ticket 04) instead, so the rename request never waits on the update loop.
const MAX_INLINE_PROPAGATION_CHUNK_COUNT = 1000;

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

export interface UpdateDocumentResult {
  document: DocumentItem;
  /** Whether the name actually changed (vs. e.g. a no-op rename to the current name). */
  hasNameChanged: boolean;
}

export const updateDocument = async (dto: UpdateDocumentDTO): Promise<UpdateDocumentResult> => {
  const sk = buildDocumentSK(dto.knowledgeBaseId, dto.id);

  const current = await getItem<DocumentItem>(DOCUMENT_PK, sk);
  if (!current) throw new DocumentNotFoundError();

  const newName = dto.name;
  const hasNameChanged = newName !== undefined && newName !== current.name;

  if (hasNameChanged && newName !== undefined) {
    const siblings = await queryAllBySkPrefix<DocumentItem & { [SK_NAME]: string }>(
      DOCUMENT_PK,
      `KB#${dto.knowledgeBaseId}#DOC#`,
    );
    const lowerName = newName.toLowerCase();
    const isDuplicate = siblings.some(
      (doc) => doc[SK_NAME] !== sk && doc.name.toLowerCase() === lowerName,
    );
    if (isDuplicate) throw new DuplicateDocumentNameError();
  }

  const updates: Partial<DocumentItem> = {};
  if (newName !== undefined) updates.name = newName;
  if (dto.indexStatus !== undefined) updates.indexStatus = dto.indexStatus;
  if (dto.indexVectorKey !== undefined) updates.indexVectorKey = dto.indexVectorKey;

  const updated = await updateItem<DocumentItem>(DOCUMENT_PK, sk, updates);

  if (
    hasNameChanged &&
    newName !== undefined &&
    dto.orgId &&
    typeof current.chunkCount === 'number' &&
    current.textFileKey
  ) {
    if (current.chunkCount <= MAX_INLINE_PROPAGATION_CHUNK_COUNT) {
      try {
        await updateChunkDocumentNameInPinecone(dto.orgId, sk, current.chunkCount, current.textFileKey, newName);
      } catch (err) {
        // The DDB write already committed and the list is correct; citations may
        // lag until the next reindex. Never let a Pinecone outage fail the rename.
        console.error(`Pinecone chunk-metadata propagation failed for ${SK_NAME}=${sk}:`, err);
      }
    } else {
      try {
        await enqueueRenameChunksJob({
          orgId: dto.orgId,
          knowledgeBaseId: dto.knowledgeBaseId,
          id: dto.id,
          sk,
          documentName: newName,
          chunkCount: current.chunkCount,
          textFileKey: current.textFileKey,
        });
      } catch (err) {
        // Same fail-open rule as the inline path: the rename already committed
        // to DDB, so a transient SQS outage must not fail the request.
        console.error(`Failed to enqueue rename-chunks job for ${SK_NAME}=${sk}:`, err);
      }
    }
  }

  return { document: updated, hasNameChanged };
};

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


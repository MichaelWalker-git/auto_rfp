/**
 * Index Solicitation Lambda
 *
 * **Invocation**: This handler is NOT exposed via HTTP API Gateway.
 * It is invoked directly from the Document Processing Step Function
 * after Textract completes text extraction from a solicitation document.
 *
 * **Trigger**: Step Function state machine (document-pipeline-step-function.ts)
 * **Input**: IndexSolicitationEvent from Step Function payload
 * **Output**: IndexSolicitationResult with chunk count
 *
 * Workflow:
 * 1. Load extracted text from S3 (output of Textract step)
 * 2. Chunk the text into overlapping segments for better retrieval
 * 3. Upload each chunk to S3 for later retrieval during chat
 * 4. Index chunks to Pinecone with opportunity namespace for vector search
 */
import { Context } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { streamToString } from '@/helpers/s3';
import { indexSolicitationChunksBatch } from '@/helpers/pinecone';
import { chunkText } from '@/handlers/document-pipeline-steps/chunk-document';

const REGION = requireEnv('REGION', 'us-east-1');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const CHUNK_MAX_CHARS = Number(process.env.CHUNK_MAX_CHARS ?? 2500);
const CHUNK_OVERLAP_CHARS = Number(process.env.CHUNK_OVERLAP_CHARS ?? 250);
const CHUNK_MIN_CHARS = Number(process.env.CHUNK_MIN_CHARS ?? 200);

const s3Client = new S3Client({ region: REGION });

interface IndexSolicitationEvent {
  opportunityId: string;
  projectId: string;
  questionFileId: string;
  fileName: string;
  textFileKey: string; // S3 key where Textract output is stored
}

interface IndexSolicitationResult {
  success: boolean;
  opportunityId: string;
  questionFileId: string;
  chunksIndexed: number;
}

const baseHandler = async (
  event: IndexSolicitationEvent,
  _context: Context,
): Promise<IndexSolicitationResult> => {
  console.log('[index-solicitation] Event:', JSON.stringify(event));

  const { opportunityId, questionFileId, fileName, textFileKey } = event;

  // Validate all required fields
  const missingFields: string[] = [];
  if (!opportunityId) missingFields.push('opportunityId');
  if (!questionFileId) missingFields.push('questionFileId');
  if (!textFileKey || textFileKey.trim() === '') missingFields.push('textFileKey');

  if (missingFields.length > 0) {
    console.warn(`[index-solicitation] Missing required fields: ${missingFields.join(', ')}, skipping indexing`);
    console.warn(`[index-solicitation] Received: opportunityId=${opportunityId}, questionFileId=${questionFileId}, fileName=${fileName}, textFileKey=${textFileKey}`);
    return {
      success: true,
      opportunityId: opportunityId || 'unknown',
      questionFileId: questionFileId || 'unknown',
      chunksIndexed: 0,
    };
  }

  console.log(`[index-solicitation] Processing: oppId=${opportunityId}, fileId=${questionFileId}, textFileKey=${textFileKey}`);

  // Load text from S3
  const res = await s3Client.send(
    new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: textFileKey,
    }),
  );

  if (!res.Body) {
    throw new Error(`S3 GetObject returned empty body for ${textFileKey}`);
  }

  const fullText = await streamToString(res.Body);

  if (!fullText || fullText.trim().length < 100) {
    console.warn(`[index-solicitation] Text too short, skipping: ${textFileKey}`);
    return {
      success: true,
      opportunityId,
      questionFileId,
      chunksIndexed: 0,
    };
  }

  // Chunk the text
  const chunks = chunkText(fullText, {
    maxChars: CHUNK_MAX_CHARS,
    overlapChars: CHUNK_OVERLAP_CHARS,
    minChars: CHUNK_MIN_CHARS,
  });

  // Prepare chunks for indexing
  const chunksToIndex = chunks.map((text, index) => ({
    questionFileId,
    fileName,
    chunkIndex: index,
    chunkKey: `chunks/${opportunityId}/${questionFileId}/chunk-${index}.txt`,
    text,
  }));

  // Upload chunks to S3 (for later retrieval)
  for (const chunk of chunksToIndex) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: chunk.chunkKey,
        Body: chunk.text,
        ContentType: 'text/plain',
      }),
    );
  }

  // Batch index to Pinecone
  await indexSolicitationChunksBatch(opportunityId, chunksToIndex);

  console.log(`[index-solicitation] Indexed ${chunks.length} chunks for ${questionFileId}`);

  return {
    success: true,
    opportunityId,
    questionFileId,
    chunksIndexed: chunks.length,
  };
};

export const handler = withSentryLambda(baseHandler);

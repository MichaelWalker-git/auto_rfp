import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { z } from 'zod';

const sqs = new SQSClient({});

// Read directly (not via `requireEnv`, which treats an empty-string default as
// "no default" and throws) — this helper is imported by every document handler
// (create/delete/edit) via `./document`, most of which never enqueue a
// rename-chunks job and don't have this env var configured.
const RENAME_CHUNKS_QUEUE_URL = process.env.RENAME_CHUNKS_QUEUE_URL || '';

export const RenameChunksJobSchema = z.object({
  orgId: z.string().min(1),
  knowledgeBaseId: z.string().min(1),
  id: z.string().min(1),
  sk: z.string().min(1),
  documentName: z.string().min(1),
  chunkCount: z.number().int().positive(),
  textFileKey: z.string().min(1),
});

export type RenameChunksJob = z.infer<typeof RenameChunksJobSchema>;

/**
 * Enqueue a chunk-metadata rename job for the async worker (ticket 04). Used
 * for documents with more than 1 000 chunks, where updating every chunk's
 * `documentName` inline would risk blocking the edit request past API Gateway's
 * timeout. The DDB row is already the source of truth by the time this is
 * called; Pinecone citations may lag until the worker finishes.
 */
export const enqueueRenameChunksJob = async (job: RenameChunksJob): Promise<void> => {
  if (!RENAME_CHUNKS_QUEUE_URL) {
    throw new Error('RENAME_CHUNKS_QUEUE_URL environment variable not configured');
  }

  console.log(`Enqueuing rename-chunks job for sk=${job.sk} (${job.chunkCount} chunks)`);

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: RENAME_CHUNKS_QUEUE_URL,
      MessageBody: JSON.stringify(job),
    }),
  );

  console.log(`Rename-chunks job enqueued for sk=${job.sk}`);
};

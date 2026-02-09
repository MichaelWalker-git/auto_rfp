import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';


export const s3 = new S3Client({});

export async function streamToString(stream: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

export async function loadTextFromS3(bucket: string, key: string): Promise<string> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return streamToString(res.Body);
  } catch (err) {
    return '';
  }
}

export async function uploadToS3(bucket: string, key: string, body: Buffer | string, contentType?: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getFileFromS3(bucket: string, key: string) {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!obj.Body) throw new Error('S3 object body is empty');
  return obj.Body;
}

/**
 * Validate and sanitize S3 key
 */
export function safeS3Key(key?: unknown): string | null {
  if (typeof key !== 'string') return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return null;
  return trimmed;
}

/**
 * Delete a single S3 object (best effort - doesn't throw on failure)
 */
export async function deleteS3Object(
  bucket: string,
  key: string,
): Promise<{ key: string; success: boolean; error?: string }> {
  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    return { key, success: true };
  } catch (err: any) {
    console.warn(`Failed to delete S3 object: ${key}`, err);
    return { key, success: false, error: err.message };
  }
}

/**
 * Batch delete S3 objects (up to 1000 per request)
 * Returns results for each key
 */
export async function batchDeleteS3Objects(
  bucket: string,
  keys: string[],
): Promise<{ deleted: number; failed: number; errors: Array<{ key: string; error: string }> }> {
  if (!keys.length) return { deleted: 0, failed: 0, errors: [] };

  const BATCH_SIZE = 1000; // S3 limit
  let deleted = 0;
  let failed = 0;
  const errors: Array<{ key: string; error: string }> = [];

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);

    try {
      const res = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch.map((key) => ({ Key: key })),
            Quiet: false,
          },
        }),
      );

      deleted += res.Deleted?.length ?? 0;

      if (res.Errors?.length) {
        for (const err of res.Errors) {
          failed++;
          errors.push({
            key: err.Key ?? 'unknown',
            error: err.Message ?? 'Unknown error',
          });
        }
      }
    } catch (err: any) {
      console.error('Batch delete S3 error:', err);
      // Mark all items in this batch as failed
      failed += batch.length;
      for (const key of batch) {
        errors.push({ key, error: err.message });
      }
    }
  }

  return { deleted, failed, errors };
}

/**
 * Delete multiple S3 objects from a list of potential keys
 * Filters out invalid keys and performs batch deletion
 */
export async function deleteS3ObjectsFromKeys(
  bucket: string,
  potentialKeys: Array<unknown>,
): Promise<{ deleted: number; failed: number; skipped: number }> {
  const validKeys: string[] = [];
  let skipped = 0;

  for (const key of potentialKeys) {
    const safeKey = safeS3Key(key);
    if (safeKey) {
      validKeys.push(safeKey);
    } else {
      skipped++;
    }
  }

  if (!validKeys.length) {
    return { deleted: 0, failed: 0, skipped };
  }

  const result = await batchDeleteS3Objects(bucket, validKeys);
  return {
    deleted: result.deleted,
    failed: result.failed,
    skipped,
  };
}

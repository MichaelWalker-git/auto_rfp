import type { DynamoDBRecord } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { requireEnv } from '@/helpers/env';
import { AUDIT_LOG_PK } from '@/constants/audit';
import { PK_NAME } from '@/constants/common';

const s3 = new S3Client({});
const AUDIT_ARCHIVE_BUCKET = requireEnv('AUDIT_ARCHIVE_BUCKET');

/**
 * Archive a TTL-removed AUDIT_LOG item to S3 Glacier.
 * Rethrows on failure so the stream batch retries — compliance archival
 * must not silently fail.
 */
export const archiveRemovedAuditLog = async (record: DynamoDBRecord): Promise<void> => {
  if (!record.dynamodb?.OldImage) return;

  const item = unmarshall(record.dynamodb.OldImage as Parameters<typeof unmarshall>[0]);
  if (item[PK_NAME] !== AUDIT_LOG_PK) return;

  try {
    const { organizationId, timestamp, logId } = item as {
      organizationId: string;
      timestamp: string;
      logId: string;
    };

    // Archive path: audit-logs/{orgId}/{year}/{month}/{day}/{logId}.json
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const key = `audit-logs/${organizationId}/${year}/${month}/${day}/${logId}.json`;

    await s3.send(new PutObjectCommand({
      Bucket: AUDIT_ARCHIVE_BUCKET,
      Key: key,
      Body: JSON.stringify(item),
      ContentType: 'application/json',
      StorageClass: 'GLACIER_IR', // Glacier Instant Retrieval
    }));

    console.log(`[audit-archive] Archived ${logId} to s3://${AUDIT_ARCHIVE_BUCKET}/${key}`);
  } catch (err) {
    console.error('[audit-archive] Failed to archive item:', err, item);
    throw err; // rethrow to retry
  }
};

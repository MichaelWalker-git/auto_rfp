import type { SQSHandler } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { AuditLogPayloadSchema } from '@auto-rfp/core';
import { writeAuditLog } from '@/helpers/audit-log';
import { requireEnv } from '@/helpers/env';
import { AUDIT_HMAC_SECRET_PARAM } from '@/constants/audit';

const ssm = new SSMClient({});
requireEnv('REGION', 'us-east-1');

let cachedHmacSecret: string | null = null;

const getHmacSecret = async (): Promise<string> => {
  if (cachedHmacSecret) return cachedHmacSecret;
  const res = await ssm.send(new GetParameterCommand({
    Name: AUDIT_HMAC_SECRET_PARAM,
    WithDecryption: true,
  }));
  cachedHmacSecret = res.Parameter?.Value ?? '';
  return cachedHmacSecret;
};

export const handler: SQSHandler = async (event) => {
  const hmacSecret = await getHmacSecret();

  for (const record of event.Records) {
    try {
      const raw = JSON.parse(record.body) as unknown;
      const { success, data, error } = AuditLogPayloadSchema.safeParse(raw);

      if (!success) {
        console.error('[audit-log-writer] Invalid payload:', error.issues);
        // Do NOT throw — invalid messages go to DLQ after maxReceiveCount
        continue;
      }

      await writeAuditLog(data, hmacSecret);
    } catch (err) {
      console.error('[audit-log-writer] Failed to write audit log:', err);
      throw err; // rethrow so SQS retries this record
    }
  }
};

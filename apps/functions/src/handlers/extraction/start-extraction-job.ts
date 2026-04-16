import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { CreateExtractionJobDTOSchema } from '@auto-rfp/core';
import { createExtractionJobRecord } from '@/helpers/extraction';
import { apiResponse } from '@/helpers/api';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { requireEnv } from '@/helpers/env';

const sqsClient = new SQSClient({ region: requireEnv('REGION', 'us-east-1') });
const EXTRACTION_QUEUE_URL = process.env.EXTRACTION_QUEUE_URL;

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { success, data, error } = CreateExtractionJobDTOSchema.safeParse(body);

    if (!success) {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: error.issues,
      });
    }

    const userId = event.auth?.userId || 'system';
    const job = await createExtractionJobRecord(data, userId);

    // Queue the job for async processing
    if (EXTRACTION_QUEUE_URL) {
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: EXTRACTION_QUEUE_URL,
          MessageBody: JSON.stringify({
            jobId: job.jobId,
            orgId: job.orgId,
          }),
        }),
      );
    }

    setAuditContext(event, {
      action: 'EXTRACTION_JOB_STARTED',
      resource: 'extraction_job',
      resourceId: job.jobId,
    });

    return apiResponse(201, {
      ok: true,
      job,
    });
  } catch (err: unknown) {
    console.error('Error starting extraction job:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return apiResponse(500, { ok: false, error: message });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);

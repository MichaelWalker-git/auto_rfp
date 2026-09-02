import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, parseJsonBody, getUserId } from '@/helpers/api';
import {
  completeImportRun,
  createImportRun,
  ImportRunAlreadyRunningError,
} from '@/helpers/employee-import';
import { createExtractionJobRecord } from '@/helpers/extraction';
import { requireEnv } from '@/helpers/env';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import type { CreateExtractionJobDTO } from '@auto-rfp/core';

const sqsClient = new SQSClient({ region: requireEnv('REGION', 'us-east-1') });
const EXTRACTION_QUEUE_URL = process.env.EXTRACTION_QUEUE_URL;

// Validate at module load — fail fast if misconfigured (same as start-extraction-job).
if (!EXTRACTION_QUEUE_URL) {
  console.error('EXTRACTION_QUEUE_URL environment variable is not set');
}

const TriggerEmployeeImportRequestSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
});

/**
 * POST /employee/import/trigger — start a generate-from-CVs run (W1 step 1-2).
 * BR1.1: one RUNNING run per org — a second trigger is refused with guidance
 * and a pointer to the running run. BR1.2: employee:manage (middleware).
 * Execution moves off the request path via the extraction queue (NFR6) with
 * the EMPLOYEE target type (ADR-004 — reuses the extraction worker).
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = parseJsonBody(event);

  const { success, data, error } = TriggerEmployeeImportRequestSchema.safeParse(raw);
  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  if (!EXTRACTION_QUEUE_URL) {
    return apiResponse(503, {
      message: 'Employee import is not configured. Please contact support.',
    });
  }

  const { orgId } = data;
  const userId = getUserId(event) ?? 'system';

  // BR1.1 — refuse while a run is RUNNING, pointing at it.
  let run;
  try {
    run = await createImportRun(orgId, userId);
  } catch (err) {
    if (err instanceof ImportRunAlreadyRunningError) {
      return apiResponse(409, {
        message:
          'An employee import is already running for this organization. Wait for it to finish — its progress is shown on the Employees page.',
        run: err.runningRun,
      });
    }
    throw err;
  }

  try {
    // Reuse the extraction pipeline: job record + queue message (ADR-004).
    const jobDto: CreateExtractionJobDTO = {
      orgId,
      sourceType: 'KB_EXTRACTION',
      targetType: 'EMPLOYEE',
    };
    const job = await createExtractionJobRecord(jobDto, userId);

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: EXTRACTION_QUEUE_URL,
        MessageBody: JSON.stringify({
          jobId: job.jobId,
          orgId,
          importRunId: run.importRunId,
        }),
      }),
    );
  } catch (err) {
    // Never leave a stuck RUNNING run blocking future triggers (BR1.1):
    // if the job cannot be enqueued, close the run FAILED and surface the error.
    console.error('Failed to enqueue employee import job:', err);
    await completeImportRun(orgId, run.importRunId, { status: 'FAILED' });
    return apiResponse(500, {
      message: 'The import could not be started. Please try again.',
    });
  }

  setAuditContext(event, {
    action: 'EMPLOYEE_IMPORT_STARTED',
    resource: 'employee',
    resourceId: run.importRunId,
    orgId,
  });

  return apiResponse(202, { run });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('employee:manage'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);

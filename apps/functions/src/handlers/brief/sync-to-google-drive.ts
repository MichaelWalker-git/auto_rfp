import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getExecutiveBrief } from '@/helpers/executive-opportunity-brief';
import { getProjectById } from '@/helpers/project';
import { enqueueGoogleDriveSync } from '@/helpers/google-drive-queue';

/**
 * On-demand Google Drive sync for an executive brief.
 *
 * Unlike the automatic GO-decision path, this is triggered by an explicit
 * "Create Drive folder" button. It enqueues the same idempotent sync job that
 * creates the `[ID] - [Agency] - [Title]` folder (under the configured intake
 * parent), its subfolders, and uploads the brief + documents. Processed async
 * via SQS so the API response is not blocked by Drive latency.
 */
const RequestSchema = z.object({
  executiveBriefId: z.string().min(1),
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const { success, data, error } = RequestSchema.safeParse(bodyJson);
    if (!success) {
      return apiResponse(400, { ok: false, error: error.issues[0]?.message ?? 'Invalid request' });
    }

    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { ok: false, error: 'orgId is required' });
    }

    const { executiveBriefId } = data;
    // Throws "ExecutiveBrief not found" if the id is unknown — surfaced as a 500 below.
    const brief = await getExecutiveBrief(executiveBriefId);

    const summaryData = (brief.sections as Record<string, { data?: Record<string, unknown> }> | undefined)
      ?.summary?.data;
    const project = await getProjectById(brief.projectId);
    const projectName = (project as Record<string, unknown>)?.name || brief.projectId;

    await enqueueGoogleDriveSync({
      orgId,
      projectId: brief.projectId,
      opportunityId: brief.opportunityId as string,
      executiveBriefId,
      linearTicketId: brief.linearTicketId as string | undefined,
      linearTicketIdentifier: brief.linearTicketIdentifier as string | undefined,
      agencyName: summaryData?.agency as string | undefined,
      projectTitle: (summaryData?.title as string | undefined) || String(projectName),
    });

    console.log(`Google Drive sync enqueued on demand for brief ${executiveBriefId}`);

    return apiResponse(202, {
      ok: true,
      executiveBriefId,
      message: 'Google Drive folder creation started',
    });
  } catch (err) {
    console.error('sync-to-google-drive error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);

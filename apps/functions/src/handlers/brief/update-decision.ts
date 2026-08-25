import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { EXEC_BRIEF_PK } from '@/constants/exec-brief';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { getExecutiveBrief } from '@/helpers/executive-opportunity-brief';
import { getProjectById } from '@/helpers/project';
import { enqueueGoogleDriveSync } from '@/helpers/google-drive-queue';
import { enqueueDriveFolderForBrief } from '@/helpers/brief-drive-folder';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Two request shapes are accepted on this route (folded together to stay under
 * the HTTP API's integration cap — see HOR-2729):
 *
 *  1. Decision update — `{ executiveBriefId, decision }`. The original,
 *     unchanged behaviour. On a GO decision it also enqueues a Drive sync.
 *  2. Drive-folder action — `{ executiveBriefId, action: 'create-drive-folder' }`.
 *     Enqueues the folder without touching the decision (the "Create Drive
 *     folder" button posts this).
 *
 * The `action` discriminator is optional, so every existing decision caller is
 * byte-for-byte unaffected.
 */
const DecisionRequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  decision: z.enum(['GO', 'NO_GO', 'CONDITIONAL_GO']),
});

const DriveFolderRequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  action: z.literal('create-drive-folder'),
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const orgId = getOrgId(event);

    // ─── Drive-folder action (folded-in "Create Drive folder" button) ───
    if ((bodyJson as { action?: unknown })?.action === 'create-drive-folder') {
      const { success, data, error } = DriveFolderRequestSchema.safeParse(bodyJson);
      if (!success) {
        return apiResponse(400, { ok: false, error: 'Invalid payload', issues: error.issues });
      }
      if (!orgId) {
        return apiResponse(400, { ok: false, error: 'orgId is required' });
      }

      const result = await enqueueDriveFolderForBrief(data.executiveBriefId, orgId);
      if (result.status === 'not_found') {
        return apiResponse(404, { ok: false, error: 'Executive brief not found' });
      }
      if (result.status === 'exists') {
        return apiResponse(200, {
          ok: true,
          status: 'exists',
          googleDriveFolderUrl: result.googleDriveFolderUrl,
          message: 'Google Drive folder already exists',
        });
      }
      return apiResponse(202, {
        ok: true,
        status: 'enqueued',
        executiveBriefId: data.executiveBriefId,
        message: 'Google Drive folder creation enqueued',
      });
    }

    const { executiveBriefId, decision } = DecisionRequestSchema.parse(bodyJson);

    const now = new Date().toISOString();

    // Step 1: Ensure nested structure exists (sections.scoring.data)
    // We do this in a separate update to avoid DynamoDB path overlap errors
    // (cannot SET both a parent path and child path in the same expression)
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: DB_TABLE_NAME,
          Key: {
            [PK_NAME]: EXEC_BRIEF_PK,
            [SK_NAME]: executiveBriefId,
          },
          UpdateExpression: `SET
            #sections = if_not_exists(#sections, :emptySections)`,
          ExpressionAttributeNames: {
            '#sections': 'sections',
          },
          ExpressionAttributeValues: {
            ':emptySections': { scoring: { data: {} } },
          },
        })
      );
    } catch {
      // Ignore — sections may already exist
    }

    // Step 2: Set the decision at both top-level and inside sections.scoring.data
    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: EXEC_BRIEF_PK,
          [SK_NAME]: executiveBriefId,
        },
        UpdateExpression: `SET
          decision = :decision,
          #sections.#scoring.#data.#decision = :decision,
          updatedAt = :now`,
        ExpressionAttributeNames: {
          '#sections': 'sections',
          '#scoring': 'scoring',
          '#data': 'data',
          '#decision': 'decision',
        },
        ExpressionAttributeValues: {
          ':decision': decision,
          ':now': now,
        },
      })
    );

    console.log(`Updated brief ${executiveBriefId} decision to ${decision}`);

    // ─── Google Drive Sync on GO Decision (async via SQS) ───
    // When the decision is manually set to GO (approval), enqueue Google Drive sync.
    // Processed asynchronously to avoid blocking the API response.
    if (decision === 'GO' && orgId) {
      try {
        console.log(`GO decision approved for brief ${executiveBriefId} — enqueuing Google Drive sync`);

        const brief = await getExecutiveBrief(executiveBriefId);
        const summaryData = (brief.sections as any)?.summary?.data;
        const project = await getProjectById(brief.projectId);
        const projectName = (project as any)?.name || brief.projectId;

        await enqueueGoogleDriveSync({
          orgId,
          projectId: brief.projectId,
          opportunityId: brief.opportunityId as string,
          executiveBriefId,
          linearTicketId: brief.linearTicketId as string | undefined,
          linearTicketIdentifier: brief.linearTicketIdentifier as string | undefined,
          agencyName: summaryData?.agency,
          projectTitle: summaryData?.title || projectName,
        });
      } catch (enqueueErr) {
        // Non-blocking — don't fail the decision update if enqueue fails
        console.error('Failed to enqueue Google Drive sync (non-blocking):', (enqueueErr as Error)?.message);
      }
    }

    return apiResponse(200, {
      ok: true,
      executiveBriefId,
      decision,
      message: `Decision updated to ${decision}`,
    });

  } catch (err) {
    console.error('update-decision error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);

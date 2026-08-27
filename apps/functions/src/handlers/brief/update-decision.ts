import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { EXEC_BRIEF_PK } from '@/constants/exec-brief';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { enqueueDriveFolderForBrief } from '@/helpers/brief-drive-folder';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Two request shapes are accepted on this route (folded together to stay under
 * the HTTP API's integration cap — see HOR-2729):
 *
 *  1. Decision update — `{ executiveBriefId, decision }`. Records the GO /
 *     NO_GO / CONDITIONAL_GO decision only. It does NOT create a Drive folder
 *     (a GO decision no longer auto-syncs — see HOR-2729).
 *  2. Drive-folder action — `{ executiveBriefId, action: 'create-drive-folder' }`.
 *     Enqueues the folder without touching the decision (the "Create Drive
 *     folder" button posts this) — the ONLY way a Drive folder is created.
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

    // A GO decision no longer auto-creates the Google Drive folder. The folder
    // is created ONLY when a user explicitly clicks "Create Drive folder"
    // (the { action: 'create-drive-folder' } branch above) — see HOR-2729.

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

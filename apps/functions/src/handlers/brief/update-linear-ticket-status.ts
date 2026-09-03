import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import {
  RFP_SELECTABLE_STAGES,
  linearStageWrite,
  type RfpSelectableStage,
} from '@auto-rfp/core';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { setLinearIssueStage } from '@/helpers/linear';
import { getExecutiveBrief } from '@/helpers/executive-opportunity-brief';

const RequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  /** RFP board stage to move the ticket to (drives Linear status + gate label). */
  stage: z.enum(RFP_SELECTABLE_STAGES as unknown as [string, ...string[]]),
});

/**
 * Moves an existing Linear ticket to a chosen RFP board stage, driven by the
 * "Set RFP Status" dialog on the brief. A stage maps to a Linear workflow status
 * plus a gate-label swap (see linearStageWrite) so the RFP board reads the same
 * stage back on its next sync. The ticket must already exist — its id is read off
 * the brief; this handler never creates one.
 */
export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'Org Id is required' });
    }

    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const { executiveBriefId, stage } = RequestSchema.parse(bodyJson);

    const brief = await getExecutiveBrief(executiveBriefId);

    if (!brief) {
      return apiResponse(404, { ok: false, error: 'Executive brief not found' });
    }

    if (!brief.linearTicketId) {
      return apiResponse(400, {
        ok: false,
        error: 'No Linear ticket exists for this brief yet',
      });
    }

    const write = linearStageWrite(stage as RfpSelectableStage);

    try {
      const updated = await setLinearIssueStage(orgId, brief.linearTicketId, write);
      if (!updated) {
        return apiResponse(502, {
          ok: false,
          error: 'Failed to update the Linear ticket status — status or team not found',
        });
      }
    } catch (err) {
      console.error('Failed to update Linear ticket status:', err);
      return apiResponse(502, {
        ok: false,
        error: 'Failed to update the Linear ticket status',
      });
    }

    return apiResponse(200, {
      ok: true,
      message: 'Linear ticket status updated',
      stage,
      ticket: {
        id: brief.linearTicketId,
        identifier: brief.linearTicketIdentifier || '',
        url: brief.linearTicketUrl || '',
      },
    });
  } catch (err) {
    console.error('update-linear-ticket-status error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);

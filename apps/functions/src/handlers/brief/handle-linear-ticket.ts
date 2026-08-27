import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { createLinearTicket, updateLinearTicket } from '@/helpers/linear';
import { buildOfferMessage } from '@/helpers/linear-offer-message';
import { getExecutiveBrief } from '@/helpers/executive-opportunity-brief';
import { getProjectById } from '@/helpers/project';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { EXEC_BRIEF_PK } from '@/constants/exec-brief';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const APP_URL = process.env['APP_URL'] ?? 'https://rfp.horustech.dev';

const RequestSchema = z.object({
  executiveBriefId: z.string().min(1),
});

/**
 * Builds the initial Linear ticket body — a preliminary-offer hand-off note
 * (HOR-2729). At creation time only the AutoRFP deep-link is known; the
 * Analysis (Google Doc) and Documents (Drive folder) links are filled in later
 * by the Google Drive sync worker, which rewrites the description once those
 * artifacts exist.
 */
function buildTicketDescription(brief: any, _project: any, orgId: string): string {
  const autoRfpUrl =
    orgId && brief.projectId && brief.opportunityId
      ? `${APP_URL}/organizations/${orgId}/projects/${brief.projectId}/opportunities/${brief.opportunityId}`
      : undefined;

  return buildOfferMessage({ autoRfpUrl });
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'Org Id is required' });
    }
    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const { executiveBriefId } = RequestSchema.parse(bodyJson);

    const brief = await getExecutiveBrief(executiveBriefId);

    if (!brief) {
      return apiResponse(404, {
        ok: false,
        error: 'Executive brief not found',
      });
    }

    const project = await getProjectById(brief.projectId);

    if (!project) {
      return apiResponse(404, {
        ok: false,
        error: 'Project not found',
      });
    }

    const summary = brief.sections?.summary?.data;
    const deadlines = brief.sections?.deadlines?.data;
    const decision = brief.decision || brief.sections?.scoring?.data?.decision;

    // Determine title prefix and labels based on decision
    let titlePrefix = '[RFP]';
    const labels = ['RFP', 'Auto-Generated'];

    if (decision === 'GO') {
      titlePrefix = '[RFP] ✅';
      labels.push('go');
    } else if (decision === 'NO_GO') {
      titlePrefix = '[RFP] ❌';
      labels.push('no-go');
    } else if (decision === 'CONDITIONAL_GO') {
      titlePrefix = '[RFP] 🔍';
      labels.push('needs-review');
    }

    const title = `${titlePrefix} ${summary?.title || project.name || 'RFP Opportunity'}`;

    if (brief.linearTicketId) {
      console.log(`Updating existing Linear ticket: ${brief.linearTicketId}`);

      try {
        await updateLinearTicket(orgId, brief.linearTicketId, {
          title: title,
          labels,
        });

        console.log(`Updated Linear ticket ${brief.linearTicketIdentifier} labels to: ${labels.join(', ')}`);

        return apiResponse(200, {
          ok: true,
          message: 'Linear ticket updated successfully',
          ticket: {
            id: brief.linearTicketId,
            identifier: brief.linearTicketIdentifier || '',
            url: brief.linearTicketUrl || '',
          },
        });
      } catch (err) {
        console.error('Failed to update Linear ticket:', err);
        return apiResponse(500, {
          ok: false,
          error: 'Failed to update existing Linear ticket',
        });
      }
    }

    // Create new ticket
    const description = buildTicketDescription(brief, project, orgId);
    const dueDate = deadlines?.submissionDeadlineIso ?? undefined;

    const ticket = await createLinearTicket({
      orgId,
      title,
      description,
      priority: 3,
      dueDate,
      labels,
    });

    if (ticket) {
      console.log(`Created Linear ticket: ${ticket.identifier} (${ticket.id}) for ${decision}`);

      // Update brief with Linear ticket info
      try {
        const identifier = String(ticket.identifier || '');
        const url = String(ticket.url || '');
        
        const updateCommand = new UpdateCommand({
          TableName: DB_TABLE_NAME,
          Key: {
            [PK_NAME]: EXEC_BRIEF_PK,
            [SK_NAME]: executiveBriefId,
          },
          UpdateExpression: 'SET linearTicketId = :ticketId, linearTicketIdentifier = :identifier, linearTicketUrl = :url, updatedAt = :now',
          ExpressionAttributeValues: {
            ':ticketId': ticket.id,
            ':identifier': identifier,
            ':url': url,
            ':now': new Date().toISOString(),
          },
        });
        
        await docClient.send(updateCommand);
      } catch (dbErr) {
        console.error(
          'Failed to update executive brief with Linear ticket information. Manual reconciliation may be required.',
          {
            executiveBriefId,
            linearTicketId: ticket.id,
            linearTicketIdentifier: ticket.identifier,
            linearTicketUrl: ticket.url,
            error: dbErr,
          }
        );
        throw dbErr;
      }
      return apiResponse(200, {
        ok: true,
        message: 'Linear ticket created successfully',
        ticket: {
          id: ticket.id,
          identifier: ticket.identifier,
          url: ticket.url,
        },
      });
    }
    return apiResponse(200, {
      ok: true,
      message: 'Linear ticket has not been create, set up api key',
    });
  } catch (err) {
    console.error('handle-linear-ticket error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
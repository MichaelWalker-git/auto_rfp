import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { createLinearTicket, updateLinearTicket } from '@/helpers/linear';
import { getExecutiveBrief } from '@/helpers/executive-opportunity-brief';
import { getProjectById } from '@/helpers/project';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { EXEC_BRIEF_PK } from '@/constants/exec-brief';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const RequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  /**
   * Absolute URL of the opportunity in the web app, e.g.
   * https://rfp.horustech.dev/organizations/<orgId>/projects/<projectId>/opportunities/<oppId>.
   * Sent by the client (it knows its own origin) so no FRONTEND_URL plumbing is
   * needed in the API stack. Required to CREATE a ticket (it is the AutoRFP
   * link in the message); the update-an-existing-ticket path ignores it.
   */
  appUrl: z.string().url().optional(),
});

/**
 * The fixed client-facing message every ticket carries, verbatim. The three
 * links are the only variable parts:
 *   - Analysis:  the brief's uploaded .docx in Drive (falls back to the folder
 *                for briefs synced before the doc URL was recorded)
 *   - Documents: the opportunity's Drive folder
 *   - AutoRFP:   the opportunity in the web app (client-supplied appUrl)
 */
function buildTicketDescription(brief: any, appUrl: string): string {
  const analysisUrl = brief.googleDriveBriefDocUrl || brief.googleDriveFolderUrl;
  const documentsUrl = brief.googleDriveFolderUrl;

  return [
    'Hi Brennen,',
    '',
    'I’ve prepared a preliminary offer for your review so we can continue moving forward.',
    'The first link contains the offer analysis, and the second includes the documents corresponding to the offer.',
    '',
    `Analysis:${analysisUrl}`,
    '',
    `Documents:${documentsUrl}`,
    '',
    `AutoRFP:${appUrl}`,
  ].join('\n');
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
    const { executiveBriefId, appUrl } = RequestSchema.parse(bodyJson);

    const brief = await getExecutiveBrief(executiveBriefId);

    if (!brief) {
      return apiResponse(404, {
        ok: false,
        error: 'Executive brief not found',
      });
    }

    // The ticket's message is nothing but the three links, so it is only
    // meaningful once the Drive folder exists. The UI gates the button on this
    // too — the guard is for direct API calls.
    if (!brief.googleDriveFolderUrl) {
      return apiResponse(400, {
        ok: false,
        error: 'Create the Google Drive folder before creating the Linear ticket',
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

    // Decision still drives the Linear labels — the title stays plain text.
    const labels = ['RFP', 'Auto-Generated'];

    if (decision === 'GO') {
      labels.push('go');
    } else if (decision === 'NO_GO') {
      labels.push('no-go');
    } else if (decision === 'CONDITIONAL_GO') {
      labels.push('needs-review');
    }

    const title = `[RFP] ${summary?.title || project.name || 'RFP Opportunity'}`;

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

    // Create new ticket — the message's AutoRFP link comes from the caller.
    if (!appUrl) {
      return apiResponse(400, {
        ok: false,
        error: 'appUrl is required to create a Linear ticket',
      });
    }
    const description = buildTicketDescription(brief, appUrl);
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
    // createLinearTicket returns null only when creation failed (missing org API
    // key, unconfigured LINEAR_TEAM_ID, or a Linear API error — logged by the
    // helper). A 200 here used to hide the failure: the UI treats 2xx as success
    // and the button just stayed "Create Linear Ticket" with no explanation.
    return apiResponse(502, {
      ok: false,
      error:
        'Linear ticket was not created — check the Linear API key in organization settings and the LINEAR_TEAM_ID configuration',
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
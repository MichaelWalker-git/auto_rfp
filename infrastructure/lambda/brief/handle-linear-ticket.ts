import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { createLinearTicket, updateLinearTicket } from '../helpers/linear';
import { getExecutiveBrief } from '../helpers/executive-opportunity-brief';
import { getProjectById } from '../helpers/project';
import { PK_NAME, SK_NAME } from '../constants/common';
import { EXEC_BRIEF_PK } from '../constants/exec-brief';
import { docClient } from '../helpers/db';
import { requireEnv } from '../helpers/env';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const RequestSchema = z.object({
  executiveBriefId: z.string().min(1),
});

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function buildTicketDescription(brief: any, _project: any): string {
  const summary = brief.sections?.summary?.data;
  const deadlines = brief.sections?.deadlines?.data;
  const scoring = brief.sections?.scoring?.data;
  const risks = brief.sections?.risks?.data;

  const parts: string[] = [];

  parts.push('# RFP Opportunity');
  parts.push('');

  if (summary?.agency) parts.push(`**Agency:** ${summary.agency}`);
  if (summary?.naics) parts.push(`**NAICS:** ${summary.naics}`);
  if (summary?.contractType) parts.push(`**Contract Type:** ${summary.contractType}`);
  if (summary?.estimatedValueUsd) {
    parts.push(`**Estimated Value:** $${summary.estimatedValueUsd.toLocaleString()} USD`);
  }
  if (summary?.placeOfPerformance) {
    parts.push(`**Place of Performance:** ${summary.placeOfPerformance}`);
  }
  parts.push('');

  if (summary?.summary) {
    parts.push('## Summary');
    parts.push(summary.summary);
    parts.push('');
  }

  const hasDeadlines = deadlines?.submissionDeadlineIso || (deadlines?.deadlines && deadlines.deadlines.length > 0);

  if (hasDeadlines) {
    parts.push('## Deadlines');

    const allDeadlines: Array<{
      label: string;
      dateTimeIso?: string;
      rawText?: string;
      timezone?: string;
      type?: string;
      isPrimary?: boolean;
    }> = [];

    if (deadlines.submissionDeadlineIso) {
      allDeadlines.push({
        label: 'Proposal Submission Deadline',
        dateTimeIso: deadlines.submissionDeadlineIso,
        type: 'PROPOSAL_DUE',
        isPrimary: true,
      });
    }

    if (deadlines.deadlines && deadlines.deadlines.length > 0) {
      deadlines.deadlines.forEach((d: any) => {
        if (d.type === 'PROPOSAL_DUE') return;

        allDeadlines.push({
          label: `${d.label || d.type}`,
          dateTimeIso: d.dateTimeIso,
          rawText: d.rawText,
          timezone: d.timezone,
          type: d.type,
        });
      });
    }

    allDeadlines.sort((a, b) => {
      if (!a.dateTimeIso) return 1;
      if (!b.dateTimeIso) return -1;
      return new Date(a.dateTimeIso).getTime() - new Date(b.dateTimeIso).getTime();
    });

    allDeadlines.forEach(d => {
      if (d.dateTimeIso) {
        parts.push(`- **${d.label}:** ${formatDate(d.dateTimeIso)}${d.timezone ? ` (${d.timezone})` : ''}`);

        if (d.isPrimary) {
          const recommendedDate = new Date(new Date(d.dateTimeIso).getTime() - 24 * 60 * 60 * 1000);
          parts.push(`  - ⚠️ *Recommended: Submit 24 hours early by ${formatDate(recommendedDate.toISOString())}*`);
        }
      } else if (d.rawText) {
        parts.push(`- **${d.label}:** ${d.rawText}`);
      }
    });

    parts.push('');
  }

  // Score
  if (brief.compositeScore || scoring?.compositeScore) {
    parts.push('## Scoring');
    parts.push(`**Composite Score:** ${brief.compositeScore || scoring.compositeScore}/5`);
    if (brief.confidence || scoring?.confidence) {
      parts.push(`**Confidence:** ${brief.confidence || scoring.confidence}%`);
    }
    parts.push('');
  }

  // Top Risks
  if (risks?.redFlags && risks.redFlags.length > 0) {
    parts.push('## Key Risks');
    risks.redFlags.slice(0, 3).forEach((risk: any) => {
      parts.push(`- **[${risk.severity}]** ${risk.flag}`);
      if (risk.whyItMatters) {
        parts.push(`  - ${risk.whyItMatters}`);
      }
    });
    parts.push('');
  }

  return parts.join('\n');
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
    const description = buildTicketDescription(brief, project);
    const dueDate = deadlines?.submissionDeadlineIso;

    const ticket = await createLinearTicket({
      orgId,
      title,
      description,
      priority: 3,
      dueDate,
      labels,
    });

    console.log(`Created Linear ticket: ${ticket.identifier} (${ticket.id}) for ${decision}`);

    // Update brief with Linear ticket info
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: DB_TABLE_NAME,
          Key: {
            [PK_NAME]: EXEC_BRIEF_PK,
            [SK_NAME]: executiveBriefId,
          },
          UpdateExpression: 'SET linearTicketId = :ticketId, linearTicketIdentifier = :identifier, linearTicketUrl = :url, updatedAt = :now',
          ExpressionAttributeValues: {
            ':ticketId': ticket.id,
            ':identifier': ticket.identifier,
            ':url': ticket.url,
            ':now': new Date().toISOString(),
          },
        })
      );
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

  } catch (err) {
    console.error('handle-linear-ticket error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
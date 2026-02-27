import { getProjectById } from './project';
import { getOpportunity } from './opportunity';
import { PK_NAME, SK_NAME } from '../constants/common';
import { docClient } from './db';
import { requireEnv } from './env';
import { nowIso } from './date';
import { DEADLINE_PK } from '../constants/deadline';
import { PutCommand, } from '@aws-sdk/lib-dynamodb';
import { safeSplitAt } from './safe-string';
import type { Deadline, DeadlinesSection } from '@auto-rfp/core';


const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Store deadlines separately as DEADLINE items for cross-project/opportunity queries
 * SK format: `${orgId}#${projectId}#${opportunityId}`
 */
export async function storeDeadlinesSeparately(
  executiveBriefId: string,
  briefProjectId: string,
  deadlinesData: DeadlinesSection,
  opportunityId?: string,
): Promise<void> {
  try {
    const project = await getProjectById(briefProjectId);

    if (!project) {
      console.error('Project not found, skipping separate deadline storage');
      return;
    }

    const sk = project?.[SK_NAME];

    const orgId = safeSplitAt(sk, '#', 0);

    if (!orgId) {
      console.error('Could not extract orgId from SK, skipping separate deadline storage', { sk });
      return;
    }

    const projectName = project?.name;
    
    // Fetch opportunity title if opportunityId is provided
    let opportunityTitle: string | null = null;
    if (opportunityId && orgId) {
      try {
        const oppResult = await getOpportunity({ orgId, projectId: briefProjectId, oppId: opportunityId });
        opportunityTitle = oppResult?.item?.title || null;
      } catch (err) {
        console.warn('Could not fetch opportunity title:', err);
      }
    }
    
    // Include opportunityId in sort key if provided
    const sortKey = opportunityId 
      ? `${orgId}#${briefProjectId}#${opportunityId}`
      : `${orgId}#${briefProjectId}`;

    const deadlineData: Partial<DeadlinesSection> = {
      hasSubmissionDeadline: deadlinesData.hasSubmissionDeadline,
      warnings: deadlinesData.warnings || [],
    };

    if (deadlinesData.deadlines && deadlinesData.deadlines.length > 0) {
      deadlineData.deadlines = deadlinesData.deadlines.map((deadline: Deadline) => ({
        type: deadline.type,
        label: deadline.label,
        dateTimeIso: deadline.dateTimeIso,
        rawText: deadline.rawText,
        timezone: deadline.timezone,
        notes: deadline.notes,
        evidence: deadline.evidence || [],
      }));
    }

    if (deadlinesData.submissionDeadlineIso) {
      deadlineData.submissionDeadlineIso = deadlinesData.submissionDeadlineIso;
    }

    await docClient.send(
      new PutCommand({
        TableName: DB_TABLE_NAME,
        Item: {
          [PK_NAME]: DEADLINE_PK,
          [SK_NAME]: sortKey,
          orgId,
          projectId: briefProjectId,
          opportunityId: opportunityId || null,
          opportunityTitle,
          projectName,
          ...deadlineData,
          source: { executiveBriefId },
          extractedAt: nowIso(),
        },
      }),
    );
  } catch (err) {
    console.error('Failed to store deadlines separately:', err);
  }
}
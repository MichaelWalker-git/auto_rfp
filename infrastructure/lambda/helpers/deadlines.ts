import { getProjectById } from './project';
import { PK_NAME, SK_NAME } from '../constants/common';
import { docClient } from './db';
import { requireEnv } from './env';
import { nowIso } from './date';
import { DEADLINE_PK } from '../constants/deadline';
import { PutCommand, } from '@aws-sdk/lib-dynamodb';


const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Store deadlines separately as DEADLINE items for cross-project queries
 */
export async function storeDeadlinesSeparately(
  executiveBriefId: string,
  briefProjectId: string,
  deadlinesData: any, // TODO use type
): Promise<void> {
  try {
    const project = await getProjectById(briefProjectId);

    if (!project) {
      console.error('Project not found, skipping separate deadline storage');
      return;
    }

    const sk = project?.[SK_NAME];

    const orgId = sk.split('#')[0];

    if (!orgId) {
      console.error('Could not extract orgId from SK, skipping separate deadline storage', { sk });
      return;
    }

    const projectName = project?.name;
    const sortKey = `${orgId}#${briefProjectId}`;

    const deadlineData: any = {
      hasSubmissionDeadline: deadlinesData.hasSubmissionDeadline,
      warnings: deadlinesData.warnings || [],
    };

    if (deadlinesData.deadlines && deadlinesData.deadlines.length > 0) {
      deadlineData.deadlines = deadlinesData.deadlines.map((deadline: any) => ({
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
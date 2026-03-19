import { Context } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand, ListExecutionsCommand } from '@aws-sdk/client-sfn';
import { v4 as uuidv4 } from 'uuid';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_FILE_PK } from '@/constants/question-file';
import { getProjectById } from '@/helpers/project';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { getOrgMembers } from '@/helpers/user';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const ANSWER_GENERATION_STATE_MACHINE_ARN = process.env.ANSWER_GENERATION_STATE_MACHINE_ARN || '';

const sfnClient = new SFNClient({});

export interface CheckAndTriggerEvent {
  projectId: string;
  orgId?: string; // Optional - will look up from project if not provided
  opportunityId: string; // Required - answer generation is per-opportunity
  questionFileId: string;
}

export interface CheckAndTriggerResult {
  triggered: boolean;
  reason: string;
  totalFiles: number;
  processedFiles: number;
  opportunityId?: string;
  executionArn?: string;
}

interface QuestionFileItem {
  questionFileId: string;
  status: string;
  projectId: string;
  updatedAt?: string;
  opportunityId?: string;
}

// Terminal states - file processing is complete (success or failure)
const TERMINAL_STATUSES = ['PROCESSED', 'FAILED'];

// Ignored states - these files should not block answer generation
const IGNORED_STATUSES = ['DELETED', 'CANCELLED'];

// Maximum age (in minutes) for a file in PROCESSING state before it's considered stale/stuck.
// Step Function timeout is 30 minutes, so anything older than 35 minutes is definitely stuck.
const STALE_PROCESSING_THRESHOLD_MINUTES = 35;

/**
 * Check if all question files for an opportunity are extracted.
 * If yes, trigger the Answer Generation Step Function for that opportunity.
 */
export const baseHandler = async (
  event: CheckAndTriggerEvent,
  _ctx: Context,
): Promise<CheckAndTriggerResult> => {
  console.log('check-and-trigger-answers event:', JSON.stringify(event));

  const { projectId, opportunityId } = event;
  let { orgId } = event;

  if (!projectId) {
    return {
      triggered: false,
      reason: 'Missing projectId',
      totalFiles: 0,
      processedFiles: 0,
    };
  }

  if (!opportunityId) {
    return {
      triggered: false,
      reason: 'Missing opportunityId',
      totalFiles: 0,
      processedFiles: 0,
    };
  }

  // Look up orgId from project if not provided (backwards compatibility)
  if (!orgId) {
    try {
      const project = await getProjectById(projectId);
      orgId = project?.orgId;
      if (orgId) {
        console.log(`Looked up orgId ${orgId} from project ${projectId}`);
      } else {
        console.warn(`Project ${projectId} has no orgId`);
      }
    } catch (err) {
      console.warn(`Failed to look up orgId for project ${projectId}:`, err);
    }
  }

  // Query all question files for this project/opportunity
  // QuestionFile SK format: {projectId}#{opportunityId}#{questionFileId}
  const allFiles: QuestionFileItem[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': QUESTION_FILE_PK,
          ':prefix': `${projectId}#${opportunityId}#`,
        },
        ExclusiveStartKey: lastKey,
      })
    );

    if (result.Items) {
      for (const item of result.Items) {
        allFiles.push({
          questionFileId: item.questionFileId as string,
          status: item.status as string,
          projectId: item.projectId as string,
          opportunityId: item.opportunityId as string | undefined,
          updatedAt: (item.updatedAt as string) ?? (item.createdAt as string),
        });
      }
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  // Filter to only this opportunity's files
  const files = allFiles.filter(f => f.opportunityId === opportunityId || !f.opportunityId);
  console.log(`Found ${files.length} question files for opportunity ${opportunityId} (project ${projectId})`);

  // Filter out ignored files (DELETED, CANCELLED)
  const relevantFiles = files.filter(f => !IGNORED_STATUSES.includes(f.status));
  
  // Detect stale files: files stuck in non-terminal status for longer than the threshold.
  // This handles cases where a Step Function execution timed out or crashed without
  // updating the file status, which would otherwise block answer generation forever.
  const now = Date.now();
  const staleThresholdMs = STALE_PROCESSING_THRESHOLD_MINUTES * 60 * 1000;

  const isStale = (f: QuestionFileItem): boolean => {
    if (TERMINAL_STATUSES.includes(f.status)) return false;
    if (!f.updatedAt) return false;
    const updatedAtMs = new Date(f.updatedAt).getTime();
    return (now - updatedAtMs) > staleThresholdMs;
  };

  // Categorize — treat stale non-terminal files as effectively FAILED
  const processedFiles = relevantFiles.filter(f => f.status === 'PROCESSED');
  const failedFiles = relevantFiles.filter(f => f.status === 'FAILED');
  const staleFiles = relevantFiles.filter(f => !TERMINAL_STATUSES.includes(f.status) && isStale(f));
  const activePendingFiles = relevantFiles.filter(f => !TERMINAL_STATUSES.includes(f.status) && !isStale(f));

  console.log(`Status: ${processedFiles.length} processed, ${failedFiles.length} failed, ${activePendingFiles.length} pending, ${staleFiles.length} stale (ignoring ${files.length - relevantFiles.length} deleted/cancelled)`);

  if (staleFiles.length > 0) {
    console.warn(`Found ${staleFiles.length} stale file(s) stuck in non-terminal status — treating as done:`,
      staleFiles.map(f => ({ id: f.questionFileId, status: f.status, updatedAt: f.updatedAt })),
    );
  }

  if (activePendingFiles.length > 0) {
    console.log(`Pending file details:`, activePendingFiles.map(f => ({ id: f.questionFileId, status: f.status, updatedAt: f.updatedAt })));
  }

  // Not all files are done yet (only truly active pending files block the trigger)
  if (activePendingFiles.length > 0) {
    return {
      triggered: false,
      reason: `${activePendingFiles.length} files still processing`,
      totalFiles: relevantFiles.length,
      processedFiles: processedFiles.length,
    };
  }

  // No successfully processed files
  if (processedFiles.length === 0) {
    return {
      triggered: false,
      reason: 'No successfully processed files',
      totalFiles: relevantFiles.length,
      processedFiles: 0,
    };
  }

  // Check if answer generation is already running for this opportunity
  if (ANSWER_GENERATION_STATE_MACHINE_ARN) {
    try {
      const executions = await sfnClient.send(
        new ListExecutionsCommand({
          stateMachineArn: ANSWER_GENERATION_STATE_MACHINE_ARN,
          statusFilter: 'RUNNING',
          maxResults: 100,
        })
      );

      // Check for running execution for this specific opportunity
      const runningForOpportunity = executions.executions?.find(e =>
        e.name?.includes(opportunityId)
      );

      if (runningForOpportunity) {
        return {
          triggered: false,
          reason: 'Answer generation already running for this opportunity',
          totalFiles: relevantFiles.length,
          processedFiles: processedFiles.length,
          opportunityId,
          executionArn: runningForOpportunity.executionArn,
        };
      }
    } catch (err) {
      console.error('Failed to check running executions:', err);
      // Continue anyway
    }
  }

  // All files done! Trigger answer generation
  if (!ANSWER_GENERATION_STATE_MACHINE_ARN) {
    console.warn('ANSWER_GENERATION_STATE_MACHINE_ARN not set, cannot trigger');
    return {
      triggered: false,
      reason: 'Answer generation state machine ARN not configured',
      totalFiles: relevantFiles.length,
      processedFiles: processedFiles.length,
    };
  }

  console.log(`All ${processedFiles.length} files processed for opportunity ${opportunityId}! Triggering answer generation...`);

  // Include opportunityId in execution name for uniqueness and tracking
  const executionName = `${opportunityId}-${Date.now()}`;
  
  const startResult = await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: ANSWER_GENERATION_STATE_MACHINE_ARN,
      name: executionName,
      input: JSON.stringify({
        projectId,
        orgId,
        opportunityId,
        triggeredBy: 'check-and-trigger-answers',
        totalFiles: processedFiles.length,
      }),
    })
  );

  // Write ANSWER_PIPELINE_STARTED audit log (non-blocking per rules)
  if (orgId) {
    getHmacSecret().then(hmacSecret => {
      writeAuditLog(
        {
          logId: uuidv4(),
          timestamp: nowIso(),
          userId: 'system',
          userName: 'system',
          organizationId: orgId,
          action: 'ANSWER_PIPELINE_STARTED' as const,
          resource: 'pipeline',
          resourceId: opportunityId,
          changes: {
            after: {
              opportunityId,
              projectId,
              totalFilesProcessed: processedFiles.length,
              executionArn: startResult.executionArn,
              triggeredBy: 'check-and-trigger-answers',
            },
          },
          ipAddress: '0.0.0.0',
          userAgent: 'system',
          result: 'success',
        },
        hmacSecret,
      );
    }).catch(err => console.warn('Failed to write ANSWER_PIPELINE_STARTED audit log:', (err as Error)?.message));
  }

  // Send ONE QUESTIONS_EXTRACTED notification per project (fires when all files are done)
  if (orgId) {
    getOrgMembers(orgId)
      .then((members) => {
        if (members.length === 0) return;
        return sendNotification(
          buildNotification(
            'QUESTIONS_EXTRACTED',
            'Questions Extracted — Generating Answers',
            `All ${processedFiles.length} document(s) have been processed and questions extracted. Answer generation is now running.`,
            {
              orgId,
              projectId,
              recipientUserIds: members.map((m) => m.userId),
              recipientEmails: members.map((m) => m.email),
            },
          ),
        );
      })
      .catch((err) => console.error('Failed to send QUESTIONS_EXTRACTED notification:', err));
  }

  return {
    triggered: true,
    reason: `Triggered answer generation for ${processedFiles.length} files`,
    totalFiles: relevantFiles.length,
    processedFiles: processedFiles.length,
    opportunityId,
    executionArn: startResult.executionArn,
  };
};

export const handler = withSentryLambda(baseHandler);
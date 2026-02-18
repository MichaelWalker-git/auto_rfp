import { Context } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand, ListExecutionsCommand } from '@aws-sdk/client-sfn';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { getProjectById } from '../helpers/project';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const ANSWER_GENERATION_STATE_MACHINE_ARN = process.env.ANSWER_GENERATION_STATE_MACHINE_ARN || '';

const sfnClient = new SFNClient({});

export interface CheckAndTriggerEvent {
  projectId: string;
  orgId?: string; // Optional - will look up from project if not provided
  questionFileId: string;
}

export interface CheckAndTriggerResult {
  triggered: boolean;
  reason: string;
  totalFiles: number;
  processedFiles: number;
  executionArn?: string;
}

interface QuestionFileItem {
  questionFileId: string;
  status: string;
  projectId: string;
}

// Terminal states - file processing is complete (success or failure)
const TERMINAL_STATUSES = ['PROCESSED', 'FAILED'];

// Ignored states - these files should not block answer generation
const IGNORED_STATUSES = ['DELETED', 'CANCELLED'];

/**
 * Check if all question files for a project are extracted.
 * If yes, trigger the Answer Generation Step Function.
 */
export const baseHandler = async (
  event: CheckAndTriggerEvent,
  _ctx: Context,
): Promise<CheckAndTriggerResult> => {
  console.log('check-and-trigger-answers event:', JSON.stringify(event));

  const { projectId } = event;
  let { orgId } = event;

  if (!projectId) {
    return {
      triggered: false,
      reason: 'Missing projectId',
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

  // Query all question files for this project
  const files: QuestionFileItem[] = [];
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
          ':prefix': `${projectId}#`,
        },
        ExclusiveStartKey: lastKey,
      })
    );

    if (result.Items) {
      for (const item of result.Items) {
        files.push({
          questionFileId: item.questionFileId as string,
          status: item.status as string,
          projectId: item.projectId as string,
        });
      }
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  console.log(`Found ${files.length} total question files for project ${projectId}`);

  // Filter out ignored files (DELETED, CANCELLED)
  const relevantFiles = files.filter(f => !IGNORED_STATUSES.includes(f.status));
  
  // Categorize
  const processedFiles = relevantFiles.filter(f => f.status === 'PROCESSED');
  const failedFiles = relevantFiles.filter(f => f.status === 'FAILED');
  const pendingFiles = relevantFiles.filter(f => !TERMINAL_STATUSES.includes(f.status));

  console.log(`Status: ${processedFiles.length} processed, ${failedFiles.length} failed, ${pendingFiles.length} pending (ignoring ${files.length - relevantFiles.length} deleted/cancelled)`);

  // Not all files are done yet
  if (pendingFiles.length > 0) {
    return {
      triggered: false,
      reason: `${pendingFiles.length} files still processing`,
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

  // Check if answer generation is already running for this project
  if (ANSWER_GENERATION_STATE_MACHINE_ARN) {
    try {
      const executions = await sfnClient.send(
        new ListExecutionsCommand({
          stateMachineArn: ANSWER_GENERATION_STATE_MACHINE_ARN,
          statusFilter: 'RUNNING',
          maxResults: 100,
        })
      );

      const runningForProject = executions.executions?.find(e => 
        e.name?.includes(projectId)
      );

      if (runningForProject) {
        return {
          triggered: false,
          reason: 'Answer generation already running for this project',
          totalFiles: relevantFiles.length,
          processedFiles: processedFiles.length,
          executionArn: runningForProject.executionArn,
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

  console.log(`All ${processedFiles.length} files processed! Triggering answer generation...`);

  const executionName = `${projectId}-${Date.now()}`;
  
  const startResult = await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: ANSWER_GENERATION_STATE_MACHINE_ARN,
      name: executionName,
      input: JSON.stringify({
        projectId,
        orgId,
        triggeredBy: 'check-and-trigger-answers',
        totalFiles: processedFiles.length,
      }),
    })
  );

  return {
    triggered: true,
    reason: `Triggered answer generation for ${processedFiles.length} files`,
    totalFiles: relevantFiles.length,
    processedFiles: processedFiles.length,
    executionArn: startResult.executionArn,
  };
};

export const handler = withSentryLambda(baseHandler);
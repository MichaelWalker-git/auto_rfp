/**
 * Business logic for handling Textract SNS callbacks.
 * Extracted from the Lambda handler to keep it slim.
 */
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SendTaskFailureCommand, SendTaskSuccessCommand, SFNClient, TaskTimedOut, TaskDoesNotExist } from '@aws-sdk/client-sfn';
import { v4 as uuidv4 } from 'uuid';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_FILE_PK } from '@/constants/question-file';
import { requireEnv } from '@/helpers/env';
import { DBItem, docClient } from '@/helpers/db';
import { QuestionFileItem, AuditLogPayload } from '@auto-rfp/core';
import { nowIso } from '@/helpers/date';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';

// Resolved lazily so tests can set process.env before module-level code runs
const getTableName = () => requireEnv('DB_TABLE_NAME');

const stepFunctionsClient = new SFNClient({});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedJobTag {
  questionFileId: string;
}

export interface FoundQuestionFile {
  item: QuestionFileItem & DBItem;
  sk: string;
  projectId: string;
  oppId: string;
}

export interface TextractMessage {
  JobId: string;
  Status: string;
  JobTag?: string;
  Timestamp?: number;
  DocumentLocation?: {
    S3ObjectName?: string;
    S3Bucket?: string;
  };
}

export interface ProcessCallbackResult {
  success: boolean;
  questionFileId?: string;
  status?: string;
  error?: string;
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Parse JobTag to extract questionFileId.
 * JobTag format: just the questionFileId (UUID, 36 chars - within 64 char limit)
 */
export const parseJobTag = (jobTag: string): ParsedJobTag | null => {
  // UUID format check: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(jobTag)) {
    return { questionFileId: jobTag };
  }
  
  console.warn(`JobTag "${jobTag}" is not a valid UUID format`);
  return null;
};

/**
 * Check if error is a task token expiry error.
 * These errors occur when the Step Function task times out before Textract completes.
 */
export const isTaskTokenExpiredError = (err: unknown): boolean => {
  if (err instanceof TaskTimedOut || err instanceof TaskDoesNotExist) {
    return true;
  }
  if (err && typeof err === 'object' && 'name' in err) {
    const errorName = (err as { name: string }).name;
    return errorName === 'TaskTimedOut' || errorName === 'TaskDoesNotExist';
  }
  return false;
};

/**
 * Find question file by questionFileId, with proper pagination.
 * DynamoDB Query only returns up to 1MB per call, so we must paginate.
 * SK format: {projectId}#{oppId}#{questionFileId}
 */
export const findQuestionFileById = async (
  questionFileId: string,
): Promise<FoundQuestionFile | null> => {
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  
  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': QUESTION_FILE_PK,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    const items = (result.Items ?? []) as (QuestionFileItem & DBItem)[];
    
    // Find item where SK ends with #questionFileId
    for (const item of items) {
      const sk = item[SK_NAME] as string;
      if (sk.endsWith(`#${questionFileId}`)) {
        // Parse SK to get projectId and oppId
        // SK format: {projectId}#{oppId}#{questionFileId}
        const parts = sk.split('#');
        if (parts.length === 3) {
          const [projectId, oppId] = parts;
          return { item, sk, projectId, oppId };
        }
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return null;
};

/**
 * Update question file status when task token has expired.
 * Mark as FAILED with an error message so user knows what happened.
 */
export const markQuestionFileAsExpired = async (
  sk: string,
  jobId: string,
): Promise<void> => {
  await docClient.send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk,
      },
      UpdateExpression: 'SET #status = :status, #errorMessage = :errorMessage, #updatedAt = :updatedAt REMOVE #taskToken',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#errorMessage': 'errorMessage',
        '#updatedAt': 'updatedAt',
        '#taskToken': 'taskToken',
      },
      ExpressionAttributeValues: {
        ':status': 'FAILED',
        ':errorMessage': `Pipeline task expired (jobId: ${jobId}). The Step Function task timed out before Textract completed. Please retry the upload.`,
        ':updatedAt': nowIso(),
      },
    }),
  );
};

/**
 * Send task success to Step Functions.
 */
export const sendTaskSuccess = async (
  taskToken: string,
  output: { questionFileId: string; oppId: string; jobId: string; status: string },
): Promise<void> => {
  await stepFunctionsClient.send(
    new SendTaskSuccessCommand({
      taskToken: taskToken.trim(),
      output: JSON.stringify(output),
    }),
  );
};

/**
 * Send task failure to Step Functions.
 */
export const sendTaskFailure = async (
  taskToken: string,
  error: string,
  cause: string,
): Promise<void> => {
  await stepFunctionsClient.send(
    new SendTaskFailureCommand({
      taskToken: taskToken.trim(),
      error,
      cause,
    }),
  );
};

/**
 * Write non-blocking audit log for pipeline events.
 */
const writeAuditLogNonBlocking = (payload: AuditLogPayload): void => {
  getHmacSecret()
    .then((secret) => writeAuditLog(payload, secret))
    .catch((err) => console.warn('Failed to write audit log (non-blocking):', err instanceof Error ? err.message : err));
};

/**
 * Process a single Textract callback message.
 * Returns the result of processing the callback.
 */
export const processTextractCallback = async (
  message: TextractMessage,
): Promise<ProcessCallbackResult> => {
  const { JobId: jobId, Status: status, JobTag: jobTag } = message;

  if (!jobId || !status) {
    console.warn('Missing JobId or Status in message');
    return { success: false, error: 'Missing JobId or Status' };
  }

  if (!jobTag) {
    console.warn('No JobTag in message');
    return { success: false, error: 'Missing JobTag' };
  }

  // Parse the JobTag to get questionFileId
  const parsed = parseJobTag(jobTag);
  if (!parsed) {
    console.error(`Failed to parse JobTag: ${jobTag}`);
    return { success: false, error: `Invalid JobTag format: ${jobTag}` };
  }

  const { questionFileId } = parsed;
  console.log(`Textract notification: questionFileId=${questionFileId}, jobId=${jobId}, status=${status}`);

  // Find question file with pagination (handles >1MB of data)
  const found = await findQuestionFileById(questionFileId);
  if (!found) {
    console.error(`No question_file found with questionFileId=${questionFileId}`);
    return { success: false, questionFileId, error: 'Question file not found' };
  }

  const { item, sk, projectId, oppId } = found;
  console.log(`Found question file: SK=${sk}, projectId=${projectId}, oppId=${oppId}`);

  const taskToken = item.taskToken as string | undefined;
  if (!taskToken) {
    console.error(`No taskToken found for questionFileId=${questionFileId}`);
    return { success: false, questionFileId, error: 'No taskToken' };
  }

  console.log(`Task token found (length: ${taskToken.length})`);

  // Get orgId for audit log
  const orgId = item.orgId ?? 'unknown';

  try {
    if (status === 'SUCCEEDED') {
      await sendTaskSuccess(taskToken, { questionFileId, oppId, jobId, status });
      console.log(`Sent task success for questionFileId=${questionFileId}, jobId=${jobId}`);

      // Non-blocking audit log for pipeline step completion
      writeAuditLogNonBlocking({
        logId: uuidv4(),
        timestamp: nowIso(),
        userId: 'system',
        userName: 'system',
        organizationId: orgId,
        action: 'PIPELINE_COMPLETED',
        resource: 'question_file',
        resourceId: questionFileId,
        changes: {
          after: { step: 'textract', jobId, projectId, oppId },
        },
        ipAddress: '0.0.0.0',
        userAgent: 'system',
        result: 'success',
      });

      return { success: true, questionFileId, status };
    } else {
      await sendTaskFailure(taskToken, 'TextractFailed', `Textract job ${jobId} finished with status=${status}`);
      console.log(`Sent task failure for questionFileId=${questionFileId}, jobId=${jobId}`);

      // Non-blocking audit log for pipeline failure
      writeAuditLogNonBlocking({
        logId: uuidv4(),
        timestamp: nowIso(),
        userId: 'system',
        userName: 'system',
        organizationId: orgId,
        action: 'PIPELINE_FAILED',
        resource: 'question_file',
        resourceId: questionFileId,
        changes: {
          after: { step: 'textract', jobId, projectId, oppId, textractStatus: status },
        },
        ipAddress: '0.0.0.0',
        userAgent: 'system',
        result: 'failure',
        errorMessage: `Textract job failed with status: ${status}`,
      });

      return { success: true, questionFileId, status };
    }
  } catch (err) {
    // Handle task token expiry errors gracefully
    if (isTaskTokenExpiredError(err)) {
      console.warn(`Task token expired for questionFileId=${questionFileId}, jobId=${jobId}`);
      await markQuestionFileAsExpired(sk, jobId);

      // Non-blocking audit log for expiry
      writeAuditLogNonBlocking({
        logId: uuidv4(),
        timestamp: nowIso(),
        userId: 'system',
        userName: 'system',
        organizationId: orgId,
        action: 'PIPELINE_FAILED',
        resource: 'question_file',
        resourceId: questionFileId,
        changes: {
          after: { step: 'textract', jobId, projectId, oppId, reason: 'task_token_expired' },
        },
        ipAddress: '0.0.0.0',
        userAgent: 'system',
        result: 'failure',
        errorMessage: 'Step Function task token expired before Textract completed',
      });

      return { success: false, questionFileId, error: 'Task token expired' };
    }
    throw err;
  }
};

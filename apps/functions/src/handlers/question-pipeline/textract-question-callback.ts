import { Context } from 'aws-lambda';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SendTaskFailureCommand, SendTaskSuccessCommand, SFNClient, TaskTimedOut, TaskDoesNotExist } from '@aws-sdk/client-sfn';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_FILE_PK } from '@/constants/question-file';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { DBItem, docClient } from '@/helpers/db';
import { QuestionFileItem } from '@auto-rfp/core';
import { nowIso } from '@/helpers/date';

const stepFunctionsClient = new SFNClient({});

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Check if error is a task token expiry error (AUTO-RFP-47)
 * These errors occur when:
 * - Task has timed out (TaskTimedOut)
 * - Task no longer exists (TaskDoesNotExist)
 * - Execution was cancelled/stopped
 */
function isTaskTokenExpiredError(err: unknown): boolean {
  if (err instanceof TaskTimedOut || err instanceof TaskDoesNotExist) {
    return true;
  }
  // Check for error name property for SDK v3 errors
  if (err && typeof err === 'object' && 'name' in err) {
    const errorName = (err as { name: string }).name;
    return errorName === 'TaskTimedOut' || errorName === 'TaskDoesNotExist';
  }
  return false;
}

/**
 * Update question file status when task token has expired
 * Mark as FAILED with an error message so user knows what happened
 */
async function markQuestionFileAsExpired(
  questionFileId: string,
  skFound: string,
  jobId: string,
): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: QUESTION_FILE_PK,
          [SK_NAME]: skFound,
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
    console.log(`Marked question file ${questionFileId} as FAILED due to task token expiry`);
  } catch (updateErr) {
    console.error(`Failed to update question file status after task expiry:`, updateErr);
  }
}

export interface TextractCallbackEvent {
  Records: Array<{
    Sns: {
      Message: string;
    };
  }>;
}

export const baseHandler = async (
  event: TextractCallbackEvent,
  _ctx: Context,
): Promise<void> => {
  console.log('textract-question-callback event:', JSON.stringify(event));

  for (const record of event.Records) {
    const sns = record.Sns;
    const message = JSON.parse(sns.Message);

    console.log('Parsed Textract message:', sns.Message);

    const jobId: string | undefined = message.JobId;
    const status: string | undefined = message.Status;
    const jobTag: string | undefined = message.JobTag;

    if (!jobId || !status) {
      console.warn('Missing JobId or Status in SNS message, skipping');
      continue;
    }

    if (!jobTag) {
      console.warn('No JobTag (questionFileId) in SNS message, skipping');
      continue;
    }

    const questionFileId = jobTag;
    console.log(
      `Textract notification for questionFileId=${questionFileId}, jobId=${jobId}, status=${status}`,
    );

    let taskToken: string | undefined;
    let skFound: string | undefined;
    let oppId: string | undefined;

    try {
      const queryRes = await docClient.send(
        new QueryCommand({
          TableName: DB_TABLE_NAME,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: {
            '#pk': PK_NAME,
          },
          ExpressionAttributeValues: {
            ':pk': QUESTION_FILE_PK,
          },
        }),
      );

      const items = (queryRes.Items || []) as (QuestionFileItem & DBItem)[];

      const item = items.find((item) => {
        return item[SK_NAME].endsWith(`#${questionFileId}`);
      });

      if (!item) {
        console.error(`No question_file found with questionFileId=${questionFileId}`);
        continue;
      }

      console.log('Found question file item:', JSON.stringify(item));

      if (item) {
        oppId = item.oppId;
        taskToken = item.taskToken as string | undefined;
        if (!taskToken) {
          console.error(`No taskToken found in item for questionFileId=${questionFileId}`);
          console.error('Item keys:', Object.keys(item));
          continue;
        }

        console.log('Task token found (length):', taskToken.length);
        console.log('Task token preview:', taskToken.substring(0, 50) + '...');
        skFound = item[SK_NAME] as string | undefined;
      } else {
        console.warn(`No question_file found ending with #${questionFileId}`);
        continue;
      }
    } catch (err) {
      console.error('Error querying question_file for taskToken:', err);
    }

    if (!skFound) {
      console.warn(`No DynamoDB item found for questionFileId=${questionFileId}; cannot update status`,);
      continue;
    }

    if (!taskToken) {
      console.warn(`No taskToken found for questionFileId=${questionFileId}, skipping Step Functions callback`);
      continue;
    }

    try {
      if (status === 'SUCCEEDED') {
        await stepFunctionsClient.send(
          new SendTaskSuccessCommand({
            taskToken: taskToken.trim(),
            output: JSON.stringify({
              questionFileId,
              oppId,
              jobId,
              status,
            }),
          }),
        );
        console.log(
          `Sent task success for questionFileId=${questionFileId}, jobId=${jobId}`,
        );
      } else {
        await stepFunctionsClient.send(
          new SendTaskFailureCommand({
            taskToken: taskToken.trim(),
            error: 'TextractFailed',
            cause: `Textract job ${jobId} finished with status=${status}`,
          }),
        );
        console.log(
          `Sent task failure for questionFileId=${questionFileId}, jobId=${jobId}`,
        );
      }
    } catch (err) {
      // Handle task token expiry errors gracefully (AUTO-RFP-47)
      // This happens when the Step Function task times out before Textract completes
      if (isTaskTokenExpiredError(err)) {
        console.warn(
          `Task token expired for questionFileId=${questionFileId}, jobId=${jobId}. ` +
          `This typically means the Step Function timed out before Textract completed.`
        );
        // Update the question file status so user knows what happened
        await markQuestionFileAsExpired(questionFileId, skFound, jobId);
        // Don't rethrow - this is a recoverable situation where we've updated the status
        continue;
      }
      console.error('Error calling Step Functions:', err);
      throw err;
    }
  }
};

export const handler = withSentryLambda(baseHandler);

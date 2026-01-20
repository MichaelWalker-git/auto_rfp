import { Context } from 'aws-lambda';
import { QueryCommand, } from '@aws-sdk/lib-dynamodb';
import { SendTaskFailureCommand, SendTaskSuccessCommand, SFNClient, } from '@aws-sdk/client-sfn';

import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { DBItem, docClient } from '../helpers/db';
import { QuestionFileItem } from '@auto-rfp/shared';

const stepFunctionsClient = new SFNClient({});

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

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
      console.error('Error calling Step Functions:', err);
      throw err;
    }
  }
};

export const handler = withSentryLambda(baseHandler);

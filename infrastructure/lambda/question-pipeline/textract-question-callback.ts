import { Context, SNSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, } from '@aws-sdk/lib-dynamodb';
import { SendTaskFailureCommand, SendTaskSuccessCommand, SFNClient, } from '@aws-sdk/client-sfn';

import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { withSentryLambda } from '../sentry-lambda';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const stepFunctionsClient = new SFNClient({});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME env var is not set');

export const baseHandler = async (
  event: SNSEvent,
  _ctx: Context,
): Promise<void> => {
  console.log('textract-question-callback event:', JSON.stringify(event));

  for (const record of event.Records) {
    const sns = record.Sns;
    const messageStr = sns.Message;

    let message: any;
    try {
      message = JSON.parse(messageStr);
    } catch (err) {
      console.warn('SNS message is not JSON, skipping:', messageStr);
      continue;
    }

    console.log('Parsed Textract message:', JSON.stringify(message));

    const jobId: string | undefined = message.JobId;
    const status: string | undefined = message.Status;
    const jobTag: string | undefined = message.JobTag; // = questionFileId

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

    // 1) Load question_file by PK + SK suffix
    // SK pattern: projectId#questionFileId → we scan via Query on PK and filter in code.
    let taskToken: string | undefined;
    let skFound: string | undefined;
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

      const items = (queryRes.Items || []) as any[];

      const item = items.find((it) =>
        String(it[SK_NAME]).endsWith(`#${questionFileId}`),
      );

      if (item) {
        taskToken = item.taskToken as string | undefined;
        skFound = item[SK_NAME];
      } else {
        console.warn(
          `No question_file found ending with #${questionFileId}`,
        );
      }
    } catch (err) {
      console.error('Error querying question_file for taskToken:', err);
    }

    if (!taskToken) {
      console.warn(
        `No taskToken found for questionFileId=${questionFileId}, skipping callback`,
      );
      continue;
    }

    // 2) Notify Step Functions
    try {
      if (status === 'SUCCEEDED') {
        await stepFunctionsClient.send(
          new SendTaskSuccessCommand({
            taskToken,
            output: JSON.stringify({
              questionFileId,
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
            taskToken,
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

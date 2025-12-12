import { Context, SNSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, } from '@aws-sdk/lib-dynamodb';
import { SendTaskFailureCommand, SendTaskSuccessCommand, SFNClient, } from '@aws-sdk/client-sfn';

import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { DocumentItem } from '../schemas/document';
import { withSentryLambda } from '../sentry-lambda';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const stepFunctionsClient = new SFNClient({});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;

if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME env var is not set');
}

export const baseHandler = async (
  event: SNSEvent,
  _context: Context,
): Promise<void> => {
  console.log('callback-handler raw event:', JSON.stringify(event));

  for (const record of event.Records) {
    const sns = record.Sns;
    const messageStr = sns.Message;

    let message: any;
    try {
      message = JSON.parse(messageStr);
    } catch (e) {
      console.warn('SNS message is not JSON, skipping:', messageStr);
      continue;
    }

    console.log('Parsed Textract SNS message:', JSON.stringify(message));

    const jobId: string | undefined = message.JobId;
    const status: string | undefined = message.Status;
    const jobTag: string | undefined = message.JobTag; // JobTag = documentId

    console.log(
      `Textract notification: jobId=${jobId}, status=${status}, jobTag=${jobTag}`,
    );

    if (!jobId || !status) {
      console.warn('Missing JobId or Status in Textract message, skipping');
      continue;
    }

    if (!jobTag) {
      console.warn(
        'No JobTag in Textract message; JobTag must be set when starting the job',
      );
      continue;
    }

    const documentId = jobTag;
    const docSuffix = `#DOC#${documentId}`;

    let taskToken: string | undefined;
    let knowledgeBaseId: string | undefined;

    try {
      const queryRes = await docClient.send(
        new QueryCommand({
          TableName: DB_TABLE_NAME,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: {
            '#pk': PK_NAME,
          },
          ExpressionAttributeValues: {
            ':pk': DOCUMENT_PK,
          },
        }),
      );

      const items = (queryRes.Items || []) as (DocumentItem & {
        [PK_NAME]: string;
        [SK_NAME]: string;
        taskToken?: string;
      })[];

      const docItem = items.find((it) =>
        String(it[SK_NAME]).endsWith(docSuffix),
      );

      if (!docItem) {
        console.warn(
          `No document with SK ending in ${docSuffix} found for documentId=${documentId}`,
        );
      } else {
        const sk = String(docItem[SK_NAME]);
        const skParts = sk.split('#'); // ["KB", "<kbId>", "DOC", "<docId>"]
        if (skParts.length >= 4) {
          knowledgeBaseId = skParts[1];
        }

        if (typeof docItem.taskToken === 'string') {
          taskToken = docItem.taskToken;
        } else {
          console.warn(`Document item for SK=${sk} has no taskToken`);
        }
      }
    } catch (err) {
      console.error(
        `Error querying DynamoDB for documentId=${documentId} to get TaskToken:`,
        err,
      );
    }

    if (!taskToken) {
      console.warn(
        `⚠️ No taskToken found for documentId=${documentId}. ` +
        'Ensure your Step Function stores the taskToken on the document item before waiting.',
      );
      continue;
    }

    try {
      if (status === 'SUCCEEDED') {
        await stepFunctionsClient.send(
          new SendTaskSuccessCommand({
            taskToken,
            output: JSON.stringify({
              jobId,
              documentId,
              knowledgeBaseId,
              status,
            }),
          }),
        );
        console.log(`Sent task success for jobId=${jobId}`);
      } else {
        await stepFunctionsClient.send(
          new SendTaskFailureCommand({
            taskToken,
            error: 'TextractFailed',
            cause: `Textract job ${jobId} finished with status=${status}`,
          }),
        );
        console.log(`Sent task failure for jobId=${jobId}`);
      }
    } catch (err) {
      console.error('Error calling Step Functions:', err);
      throw err;
    }
  }
};

export const handler = withSentryLambda(baseHandler);
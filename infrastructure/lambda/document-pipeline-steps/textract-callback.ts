import { Context, SNSEvent } from 'aws-lambda';
import { QueryCommand, UpdateCommand, } from '@aws-sdk/lib-dynamodb';
import { Block, GetDocumentTextDetectionCommand, TextractClient, } from '@aws-sdk/client-textract';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SendTaskFailureCommand, SendTaskSuccessCommand, SFNClient, } from '@aws-sdk/client-sfn';

import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { DocumentItem } from '../schemas/document';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';

const REGION = requireEnv('REGION', 'us-east-1');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const textractClient = new TextractClient({ region: REGION });
const s3Client = new S3Client({ region: REGION });
const stepFunctionsClient = new SFNClient({ region: REGION });

type DynDoc = DocumentItem & {
  [PK_NAME]: string;
  [SK_NAME]: string;
  taskToken?: string;
  fileKey?: string;
  contentType?: string;
  mimeType?: string;
  jobId?: string;
  textFileKey?: string;
};

function buildTxtKeyNextToOriginal(originalKey: string): string {
  const clean = originalKey.split('?')[0];
  const idx = clean.lastIndexOf('.');
  if (idx === -1) return `${clean}.txt`;
  return `${clean.slice(0, idx)}.txt`;
}

function buildTextFromBlocks(blocks: Block[]): string {
  return blocks
    .filter((b) => b.BlockType === 'LINE' && b.Text)
    .map((b) => b.Text!.trim())
    .filter(Boolean)
    .join('\n');
}

async function readAllTextractBlocks(jobId: string): Promise<Block[]> {
  const all: Block[] = [];
  let nextToken: string | undefined;

  // first page
  const first = await textractClient.send(
    new GetDocumentTextDetectionCommand({ JobId: jobId }),
  );

  if (first.Blocks) all.push(...first.Blocks);
  nextToken = first.NextToken;

  while (nextToken) {
    const page = await textractClient.send(
      new GetDocumentTextDetectionCommand({
        JobId: jobId,
        NextToken: nextToken,
      }),
    );
    if (page.Blocks) all.push(...page.Blocks);
    nextToken = page.NextToken;
  }

  return all;
}

export const baseHandler = async (
  event: SNSEvent,
  _context: Context,
): Promise<void> => {
  console.log('textract-callback event:', JSON.stringify(event));

  for (const record of event.Records) {
    const messageStr = record.Sns.Message;

    let message: any;
    try {
      message = JSON.parse(messageStr);
    } catch {
      console.warn('SNS message is not JSON, skipping:', messageStr);
      continue;
    }

    const jobId: string | undefined = message.JobId;
    const status: string | undefined = message.Status;
    const jobTag: string | undefined = message.JobTag; // we set JobTag=documentId in pdf-processing.ts

    console.log(`Textract notification: jobId=${jobId}, status=${status}, jobTag=${jobTag}`);

    if (!jobId || !status || !jobTag) {
      console.warn('Missing JobId/Status/JobTag, skipping');
      continue;
    }

    const documentId = jobTag;
    const docSuffix = `#DOC#${documentId}`;

    // 1) Load document row to get taskToken + fileKey (+ KB id from SK)
    let docItem: DynDoc | undefined;
    try {
      const queryRes = await docClient.send(
        new QueryCommand({
          TableName: DB_TABLE_NAME,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': PK_NAME },
          ExpressionAttributeValues: { ':pk': DOCUMENT_PK },
        }),
      );

      const items = (queryRes.Items || []) as DynDoc[];
      docItem = items.find((it) => String(it[SK_NAME]).endsWith(docSuffix));
    } catch (err) {
      console.error('Error querying DynamoDB for document row:', err);
      continue;
    }

    if (!docItem) {
      console.warn(`No document found ending with ${docSuffix}`);
      continue;
    }

    const pk = docItem[PK_NAME];
    const sk = docItem[SK_NAME];
    const taskToken = docItem.taskToken;

    let knowledgeBaseId: string | undefined;
    const skParts = String(sk).split('#'); // "KB#<kbId>#DOC#<docId>"
    if (skParts.length >= 4) knowledgeBaseId = skParts[1];

    if (!taskToken) {
      console.warn(`No taskToken found on document item SK=${sk}; cannot resume Step Functions`);
      continue;
    }

    // 2) If failed -> update status + SendTaskFailure
    if (status !== 'SUCCEEDED') {
      const now = new Date().toISOString();
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: DB_TABLE_NAME,
            Key: { [PK_NAME]: pk, [SK_NAME]: sk },
            UpdateExpression: 'SET #indexStatus = :s, #updatedAt = :u',
            ExpressionAttributeNames: {
              '#indexStatus': 'indexStatus',
              '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':s': 'TEXT_EXTRACTION_FAILED',
              ':u': now,
            },
          }),
        );
      } catch (e) {
        console.warn('Failed to update Dynamo status for failure:', e);
      }

      await stepFunctionsClient.send(
        new SendTaskFailureCommand({
          taskToken,
          error: 'TextractFailed',
          cause: `Textract job ${jobId} finished with status=${status}`,
        }),
      );
      continue;
    }

    // 3) SUCCEEDED -> fetch full text, store to S3 next to original, update Dynamo, SendTaskSuccess
    const fileKey = docItem.fileKey;
    if (!fileKey) {
      console.error(`Document SK=${sk} has no fileKey; cannot compute txtKey`);
      await stepFunctionsClient.send(
        new SendTaskFailureCommand({
          taskToken,
          error: 'MissingFileKey',
          cause: 'DynamoDB document item has no fileKey',
        }),
      );
      continue;
    }

    try {
      const blocks = await readAllTextractBlocks(jobId);
      const text = buildTextFromBlocks(blocks);

      if (!text.trim()) {
        await stepFunctionsClient.send(
          new SendTaskFailureCommand({
            taskToken,
            error: 'EmptyText',
            cause: 'Textract succeeded but extracted text is empty',
          }),
        );
        continue;
      }

      const txtKey = buildTxtKeyNextToOriginal(fileKey);

      await s3Client.send(
        new PutObjectCommand({
          Bucket: DOCUMENTS_BUCKET,
          Key: txtKey,
          Body: Buffer.from(text, 'utf-8'),
          ContentType: 'text/plain; charset=utf-8',
        }),
      );

      const now = new Date().toISOString();

      await docClient.send(
        new UpdateCommand({
          TableName: DB_TABLE_NAME,
          Key: { [PK_NAME]: pk, [SK_NAME]: sk },
          UpdateExpression:
            'SET #indexStatus = :s, #textFileKey = :t, #updatedAt = :u REMOVE #taskToken',
          ExpressionAttributeNames: {
            '#indexStatus': 'indexStatus',
            '#textFileKey': 'textFileKey',
            '#updatedAt': 'updatedAt',
            '#taskToken': 'taskToken',
          },
          ExpressionAttributeValues: {
            ':s': 'TEXT_EXTRACTED',
            ':t': txtKey,
            ':u': now,
          },
        }),
      );

      // IMPORTANT: output becomes the input for the next step (chunking)
      await stepFunctionsClient.send(
        new SendTaskSuccessCommand({
          taskToken,
          output: JSON.stringify({
            documentId,
            knowledgeBaseId,
            jobId,
            status: 'TEXT_EXTRACTED',
            bucket: DOCUMENTS_BUCKET,
            txtKey,
            textLength: text.length,
          }),
        }),
      );

      console.log(`✅ Stored txt to s3://${DOCUMENTS_BUCKET}/${txtKey} and resumed SFN for ${documentId}`);
    } catch (err: any) {
      console.error('Error processing Textract success path:', err);

      const now = new Date().toISOString();
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: DB_TABLE_NAME,
            Key: { [PK_NAME]: pk, [SK_NAME]: sk },
            UpdateExpression: 'SET #indexStatus = :s, #updatedAt = :u',
            ExpressionAttributeNames: {
              '#indexStatus': 'indexStatus',
              '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':s': 'TEXT_EXTRACTION_FAILED',
              ':u': now,
            },
          }),
        );
      } catch (e) {
        console.warn('Failed to update Dynamo status after exception:', e);
      }

      await stepFunctionsClient.send(
        new SendTaskFailureCommand({
          taskToken,
          error: 'TextractCallbackError',
          cause: err?.message || 'Unknown error in callback',
        }),
      );
    }
  }
};

export const handler = withSentryLambda(baseHandler);

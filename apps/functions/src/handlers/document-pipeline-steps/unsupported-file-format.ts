import { Context } from 'aws-lambda';
import { withSentryLambda } from '@/sentry-lambda';
import { docClient } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { DOCUMENT_PK } from '@/constants/document';
import { buildDocumentSK } from '@/helpers/document';
import { nowIso } from '@/helpers/date';
import { requireEnv } from '@/helpers/env';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');


interface Event {
  knowledgeBaseId: string;
  documentId: string;
}

export const baseHandler = async (event: Event, _ctx: Context) => {
  const { knowledgeBaseId, documentId } = event;
  if (!knowledgeBaseId || !documentId)
    throw new Error('knowledgeBaseId, documentId are required');

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: DOCUMENT_PK,
        [SK_NAME]: buildDocumentSK(knowledgeBaseId, documentId),
      },
      UpdateExpression:
        'SET #indexStatus = :status, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#indexStatus': 'indexStatus',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':status': 'failed',
        ':updatedAt': nowIso(),
      },
    }),
  );
  return {};
};

export const handler = withSentryLambda(baseHandler);

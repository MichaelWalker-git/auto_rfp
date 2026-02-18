import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { DOCUMENT_PK } from '@/constants/document';
import { withSentryLambda } from '../../sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { buildDocumentSK } from '@/helpers/document';
import { nowIso } from '@/helpers/date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (event: any): Promise<APIGatewayProxyResultV2> => {
  console.log('UpdateStatus input:', JSON.stringify(event));

  const { documentId, knowledgeBaseId, chunkCount = 0 } = event;

  if (!documentId || !knowledgeBaseId) {
    console.error('Missing required fields.');
    return { statusCode: 400, body: 'Missing documentId or knowledgeBaseId' };
  }

  const sk = buildDocumentSK(knowledgeBaseId, documentId)

  const now = nowIso();

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: DOCUMENT_PK,
        [SK_NAME]: sk
      },
      UpdateExpression: `
        SET indexStatus = :ready,
            updatedAt = :now,
            indexedAt = :now,
            chunkCount = :chunks
      `,
      ExpressionAttributeValues: {
        ':ready': 'ready',
        ':now': now,
        ':chunks': chunkCount
      }
    })
  );

  return apiResponse(200, {
    message: 'Document indexStatus updated',
    status: 'ready',
    documentId,
    knowledgeBaseId
  });
};

export const handler = withSentryLambda(baseHandler);

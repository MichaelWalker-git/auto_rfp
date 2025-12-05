import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';
import { KNOWLEDGE_BASE_PK } from '../constants/organization';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;

if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME environment variable is not set');
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId, kbId } = event.pathParameters || {};

    const sk = `${orgId}#${kbId}`;

    try {
      await docClient.send(
        new DeleteCommand({
          TableName: DB_TABLE_NAME,
          Key: {
            [PK_NAME]: KNOWLEDGE_BASE_PK,
            [SK_NAME]: sk,
          },
          ConditionExpression: 'attribute_exists(#pk)',
          ExpressionAttributeNames: {
            '#pk': PK_NAME,
          },
        }),
      );
    } catch (err: any) {
      // ConditionalCheckFailedException -> item not found
      if (err?.name === 'ConditionalCheckFailedException') {
        return apiResponse(404, {
          message: 'Knowledge base not found',
          orgId,
          kbId,
        });
      }

      console.error('Error deleting knowledge base:', err);
      return apiResponse(500, {
        message: 'Failed to delete knowledge base',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    return apiResponse(200, {
      message: 'Knowledge base deleted successfully',
      orgId,
      kbId,
    });
  } catch (err) {
    console.error('Unhandled error in deleteKnowledgeBase handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, } from '@aws-sdk/lib-dynamodb';
import { ORG_PK } from '../constants/organization';
import { PK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';

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

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const list = await listOrganizations();
    const result = list.map((org) => enrichUsersCount(org));
    return apiResponse(200, result);
  } catch (err) {
    console.error('Error in organizations handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};


export async function listOrganizations() {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined = undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :orgPk',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
        },
        ExpressionAttributeValues: {
          ':orgPk': ORG_PK,
        },
        ExclusiveStartKey,
      }),
    );

    if (res.Items && res.Items.length > 0) {
      items.push(...res.Items);
    }

    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, any> | undefined;
  } while (ExclusiveStartKey);

  return items;
}

const enrichUsersCount = (org: { sort_key: string }) => {
  const count = {
    organizationUsers: 0,
    projects: 0,
  };
  return { ...org, _count: count, id: orgSortKeyToId(org.sort_key) };
};


const orgSortKeyToId = (sortKey: string) => {
  return sortKey.split('#')[1]
}
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';

const REGION = requireEnv('REGION', 'us-east-1');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const ddbClient = new DynamoDBClient({ region: REGION });
export const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export type DBItem = {
  [PK_NAME]: string;
  [SK_NAME]: string;
  createdAt?: string;
  updatedAt?: string;
}


export const deleteItem = async (pk: string, sk: string) => {
  console.log('Deleting record from DynamoDB', DB_TABLE_NAME, pk, sk);
  return await docClient.send(
    new DeleteCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: pk,
        [SK_NAME]: sk,
      },
    }),
  );
};

export const getItem = async <T>(
  pk: string,
  sk: string,
): Promise<T | null> => {
  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: pk,
        [SK_NAME]: sk,
      },
    }),
  );

  return (res.Item as T) ?? null;
};

export const queryBySkPrefix = async <T>(pk: string, skPrefix: string): Promise<T[]> => {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': pk,
        ':skPrefix': skPrefix,
      },
    }),
  );

  return (res.Items as T[]) ?? [];
};

export const queryByPkAndSkContains = async <T>(
  pk: string,
  skSubstring: string,
): Promise<T[]> => {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': pk,
      },
    }),
  );

  return ((res.Items as T[]) ?? []).filter((item: any) =>
    item[SK_NAME]?.includes(skSubstring)
  );
};

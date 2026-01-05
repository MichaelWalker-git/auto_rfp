import { DynamoDBDocumentClient, } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';

const REGION = requireEnv('REGION', 'us-east-1');

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
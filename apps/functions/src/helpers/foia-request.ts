import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { FOIA_REQUEST_PK } from '@/constants/organization';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import type { DBFOIARequestItem } from '@/types/project-outcome';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Get a FOIA request by its identifiers
 */
export const getFOIARequest = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  foiaRequestId: string
): Promise<DBFOIARequestItem | null> => {
  const sortKey = `${orgId}#${projectId}#${opportunityId}#${foiaRequestId}`;

  const cmd = new GetCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: FOIA_REQUEST_PK,
      [SK_NAME]: sortKey,
    },
  });

  const result = await docClient.send(cmd);

  return (result.Item as DBFOIARequestItem) ?? null;
};

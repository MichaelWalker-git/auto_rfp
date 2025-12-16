import { DynamoDBDocumentClient, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { ORG_PK, PROJECT_PK } from '../constants/organization';

export async function getProjectById(docClient: DynamoDBDocumentClient, tableName: string, projectId: string): Promise<any | null> {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined = undefined;

  // Suffix used in SK: "<orgId>#<projectId>"
  const idSuffix = `#${projectId}`;

  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: '#pk = :pkValue AND contains(#sk, :idSuffix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pkValue': PROJECT_PK,
          ':idSuffix': idSuffix,
        },
        ExclusiveStartKey,
      }),
    );

    if (res.Items && res.Items.length > 0) {
      items.push(...res.Items);
    }

    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, any> | undefined;
  } while (ExclusiveStartKey);

  if (items.length === 0) {
    return null;
  }

  // From filtered results, pick the one whose SK really ends with "#<projectId>"
  const exact = items.find((item) => {
    const sk = item[SK_NAME];
    return typeof sk === 'string' && sk.endsWith(idSuffix);
  });

  const orgId: string = exact.sort_key.split('#')[0]
  const orgRes = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: {
      [PK_NAME]: ORG_PK,
      [SK_NAME]: orgId,
    },
  }))

  const withOrg = {
    ...exact,
    organization: orgRes.Item
  }

  return withOrg ?? null;
}

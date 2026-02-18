import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '../constants/common';
import { PROJECT_KB_PK, buildProjectKBSK, ProjectKBLink } from '@auto-rfp/core';
import { docClient } from './db';
import { requireEnv } from './env';
import { nowIso } from './date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Link a knowledge base to a project.
 */
export async function linkKBToProject(
  orgId: string,
  projectId: string,
  kbId: string,
  createdBy?: string,
): Promise<ProjectKBLink> {
  const now = nowIso();
  const sk = buildProjectKBSK(projectId, kbId);

  const item: ProjectKBLink & Record<string, any> = {
    [PK_NAME]: PROJECT_KB_PK,
    [SK_NAME]: sk,
    projectId,
    kbId,
    orgId,
    createdAt: now,
    createdBy,
  };

  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: item,
      ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
    }),
  );

  return item;
}

/**
 * Unlink a knowledge base from a project.
 */
export async function unlinkKBFromProject(
  projectId: string,
  kbId: string,
): Promise<void> {
  const sk = buildProjectKBSK(projectId, kbId);

  await docClient.send(
    new DeleteCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: PROJECT_KB_PK, [SK_NAME]: sk },
    }),
  );
}

/**
 * Get all KB IDs linked to a project.
 */
export async function getLinkedKBIds(projectId: string): Promise<string[]> {
  const links = await getProjectKBLinks(projectId);
  return links.map((l) => l.kbId);
}

/**
 * Get all PROJECT_KB link records for a project.
 */
export async function getProjectKBLinks(projectId: string): Promise<ProjectKBLink[]> {
  const links: ProjectKBLink[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: {
          ':pk': PROJECT_KB_PK,
          ':skPrefix': `${projectId}#`,
        },
        ExclusiveStartKey,
      }),
    );

    for (const item of res.Items ?? []) {
      links.push(item as ProjectKBLink);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return links;
}

/**
 * Delete all PROJECT_KB links for a project (used when deleting a project).
 */
export async function deleteAllLinksForProject(projectId: string): Promise<number> {
  const links = await getProjectKBLinks(projectId);
  for (const link of links) {
    await unlinkKBFromProject(link.projectId, link.kbId);
  }
  return links.length;
}

/**
 * Delete all PROJECT_KB links that reference a specific KB (used when deleting a KB).
 * Note: This requires scanning all PROJECT_KB items since we can't query by kbId directly.
 */
export async function deleteAllLinksForKB(kbId: string): Promise<number> {
  let deleted = 0;
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk',
        FilterExpression: '#kbId = :kbId',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#kbId': 'kbId' },
        ExpressionAttributeValues: {
          ':pk': PROJECT_KB_PK,
          ':kbId': kbId,
        },
        ExclusiveStartKey,
      }),
    );

    for (const item of res.Items ?? []) {
      const link = item as ProjectKBLink;
      await unlinkKBFromProject(link.projectId, link.kbId);
      deleted++;
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return deleted;
}

import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoDBDocumentClient, DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { apiResponse } from '../helpers/api';
import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants/common';
import { PROJECT_PK, PROJECT_INDEX_PK } from '../constants/organization';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT;

const UpdateIndexesSchema = z.object({
  indexIds: z.array(z.string()),
});

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const projectId = event.pathParameters?.projectId;
    if (!projectId) return apiResponse(400, { error: 'projectId is required' });

    if (!event.body) return apiResponse(400, { error: 'Missing body' });

    const parsed = UpdateIndexesSchema.safeParse(JSON.parse(event.body));
    if (!parsed.success) {
      return apiResponse(400, { error: parsed.error.message });
    }

    const { indexIds } = parsed.data;

    const project = await getProject(projectId);
    if (!project) return apiResponse(404, { error: 'Project not found' });

    if (indexIds.length === 0) {
      await removeAllProjectIndexes(projectId);
      return apiResponse(200, {
        success: true,
        projectIndexes: [],
      });
    }

    // Fetch available OpenSearch indexes
    const availableIndexes = await fetchOpenSearchIndexes();
    const availIds = new Set(availableIndexes.map((i: any) => i.index));

    // Validate
    const invalid = indexIds.filter((id) => !availIds.has(id));
    if (invalid.length > 0) {
      return apiResponse(400, {
        error: `Invalid OpenSearch index IDs: ${invalid.join(', ')}`,
      });
    }

    // Remove old
    await removeAllProjectIndexes(projectId);

    // Add new refs
    for (const id of indexIds) {
      await ddb.send(
        new PutCommand({
          TableName: process.env.DB_TABLE_NAME!,
          Item: {
            [PK_NAME]: PROJECT_INDEX_PK,
            [SK_NAME]: `${projectId}#${id}`,
            projectId,
            indexId: id,
            indexName: id,
          },
        }),
      );
    }

    return apiResponse(200, {
      success: true,
      projectIndexes: indexIds.map((id) => ({ id, name: id })),
    });
  } catch (err) {
    console.error('Error updating project indexes:', err);
    return apiResponse(500, { error: 'Internal server error' });
  }
};

// ---- helpers ----

async function getProject(projectId: string) {
  const idSuffix = `#${projectId}`;
  const res = await ddb.send(
    new QueryCommand({
      TableName: process.env.DB_TABLE_NAME!,
      KeyConditionExpression: '#pk = :pk',
      FilterExpression: 'contains(#sk, :suffix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': PROJECT_PK,
        ':suffix': idSuffix,
      },
    }),
  );

  return res.Items?.find((i) => i[SK_NAME].endsWith(idSuffix)) ?? null;
}

async function removeAllProjectIndexes(projectId: string) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: process.env.DB_TABLE_NAME!,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': PROJECT_INDEX_PK,
        ':prefix': `${projectId}#`,
      },
    }),
  );

  for (const item of res.Items ?? []) {
    await ddb.send(
      new DeleteCommand({
        TableName: process.env.DB_TABLE_NAME!,
        Key: {
          [PK_NAME]: PROJECT_INDEX_PK,
          [SK_NAME]: item[SK_NAME],
        },
      }),
    );
  }
}

async function fetchOpenSearchIndexes() {
  const response = await fetch(`${OPENSEARCH_ENDPOINT}/_cat/indices?format=json`);
  if (!response.ok) throw new Error('Failed to fetch OpenSearch indexes');
  return response.json();
}

import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { PROJECT_PK, PROJECT_INDEX_PK } from '../constants/organization';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

// OS Serverless API endpoint
const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT;

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const projectId = event.pathParameters?.projectId;

    if (!projectId) {
      return apiResponse(400, { error: 'projectId is required' });
    }

    // 1. Get project
    const project = await getProject(projectId);
    if (!project) {
      return apiResponse(404, { error: 'Project not found' });
    }

    const { orgId } = project;

    // 2. Get current project indexes (Dynamo)
    const currentIndexRefs = await listProjectIndexes(projectId);

    // 3. Fetch indexes from OpenSearch
    const osIndexes = await fetchOpenSearchIndexes();

    const availableIndexes = osIndexes.map((idx: any) => ({
      id: idx.index,
      name: idx.index,
    }));

    const availableIds = new Set(availableIndexes.map((i: any) => i.id));

    // 4. Filter only existing indexes
    const currentIndexes = currentIndexRefs.filter((ref) =>
      availableIds.has(ref.indexId),
    );

    // 5. Delete stale index references
    const stale = currentIndexRefs.filter(
      (ref) => !availableIds.has(ref.indexId),
    );

    for (const staleRef of stale) {
      await removeProjectIndex(projectId, staleRef.indexId);
    }

    return apiResponse(200, {
      project: {
        id: projectId,
        name: project.name,
        orgId,
      },
      currentIndexes: currentIndexes.map((i) => ({
        id: i.indexId,
        name: i.indexName,
      })),
      availableIndexes,
    });
  } catch (err) {
    console.error('Error in getProjectIndexes:', err);
    return apiResponse(500, { error: 'Internal server error' });
  }
};

// ----- Helper Functions -----

async function getProject(projectId: string) {
  // Query by PK=PROJECT_PK and SK ends with projectId
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

  return res.Items?.find((item) => item[SK_NAME].endsWith(idSuffix)) ?? null;
}

async function listProjectIndexes(projectId: string) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: process.env.DB_TABLE_NAME!,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': PROJECT_INDEX_PK,
        ':skPrefix': `${projectId}#`,
      },
    }),
  );
  return res.Items ?? [];
}

async function removeProjectIndex(projectId: string, indexId: string) {
  await ddb.send(
    new DeleteCommand({
      TableName: process.env.DB_TABLE_NAME!,
      Key: {
        [PK_NAME]: PROJECT_INDEX_PK,
        [SK_NAME]: `${projectId}#${indexId}`,
      },
    }),
  );
}

async function fetchOpenSearchIndexes() {
  const response = await fetch(`${OPENSEARCH_ENDPOINT}/_cat/indices?format=json`);
  if (!response.ok) {
    throw new Error('Failed to fetch OpenSearch indexes');
  }
  return response.json();
}

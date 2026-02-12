import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '../sentry-lambda';
import { listRFPDocumentsByProject } from '../helpers/rfp-document';
import { enrichWithUserNames } from '../helpers/resolve-users';
import { apiResponse, getOrgId } from '../helpers/api';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });

    const projectId = event.queryStringParameters?.projectId;
    if (!projectId) {
      return apiResponse(400, { message: 'projectId is required' });
    }

    const opportunityId = event.queryStringParameters?.opportunityId;
    const limit = Math.min(Number(event.queryStringParameters?.limit || 50), 100);
    const nextToken = event.queryStringParameters?.nextToken
      ? JSON.parse(Buffer.from(event.queryStringParameters.nextToken, 'base64').toString())
      : undefined;

    const result = await listRFPDocumentsByProject({
      projectId,
      opportunityId: opportunityId || undefined,
      limit,
      nextToken,
    });

    // Filter by orgId for security
    const filtered = result.items.filter((item: any) => item.orgId === orgId);

    // Enrich with user display names
    await enrichWithUserNames(orgId, filtered);

    return apiResponse(200, {
      ok: true,
      items: filtered,
      nextToken: result.nextToken
        ? Buffer.from(JSON.stringify(result.nextToken)).toString('base64')
        : null,
      count: filtered.length,
    });
  } catch (err) {
    console.error('Error in get-rfp-documents:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(middy(baseHandler));
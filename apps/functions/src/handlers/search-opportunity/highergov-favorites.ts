/**
 * GET /search-opportunities/highergov-favorites
 *
 * Returns a list of the user's HigherGov pursuits (favorites) with import status.
 * Used by the frontend to show "X favorites available to import" banner.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { getApiKey } from '@/helpers/api-key-storage';
import { HIGHERGOV_SECRET_PREFIX, HIGHERGOV_BASE_URL } from '@/constants/highergov';
import { fetchHigherGovPursuits, type HigherGovConfig } from '@/helpers/highergov';

const httpsAgent = new https.Agent({ keepAlive: true });

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const apiKey = await getApiKey(orgId, HIGHERGOV_SECRET_PREFIX);
  if (!apiKey) {
    return apiResponse(200, { configured: false, pursuits: [], unimportedCount: 0, totalCount: 0 });
  }

  try {
    const cfg: HigherGovConfig = { baseUrl: HIGHERGOV_BASE_URL, apiKey, httpsAgent };

    // Fetch just first page of pursuits (fast — single API call)
    const resp = await fetchHigherGovPursuits(cfg, { pageNumber: 1, pageSize: 100 });
    console.log(`[highergov-favorites] Fetched ${resp.results.length} pursuits (of ${resp.totalCount}) for org ${orgId}`);

    // Note: imported/existingOppId are always false/null here — dedup happens at import time
    const results = resp.results.map((p) => ({
      oppKey: p.opp_key ?? p.unique_key,
      title: p.title ?? p.opp_key ?? p.unique_key,
      agency: p.agency ?? null,
      dueDate: p.due_date ?? null,
      postedDate: p.posted_date ?? null,
      sourceType: p.source_type ?? null,
      imported: false,
      existingOppId: null,
    }));

    return apiResponse(200, {
      configured: true,
      pursuits: results,
      // Assume all are unimported — dedup happens at import time, not here
      unimportedCount: results.length,
      totalCount: resp.totalCount,
    });
  } catch (err) {
    console.error('[highergov-favorites] Failed to fetch pursuits:', (err as Error)?.message);
    return apiResponse(200, {
      configured: true,
      pursuits: [],
      unimportedCount: 0,
      totalCount: 0,
      error: (err as Error)?.message,
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);

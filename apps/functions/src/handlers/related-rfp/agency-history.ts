/**
 * GET /related-rfps/agency-history?orgId&projectId&oppId&q=
 *
 * Powers the manual-add picker (HOR-2610): searches the issuing agency's RFP
 * history on HigherGov, optionally narrowed by a free-text query `q`, and flags
 * which results are already linked to the current opportunity.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import https from 'https';
import middy from '@middy/core';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { getApiKey } from '@/helpers/api-key-storage';
import { HIGHERGOV_SECRET_PREFIX, HIGHERGOV_BASE_URL } from '@/constants/highergov';
import {
  fetchHigherGovOpportunity,
  searchHigherGovOpportunities,
  type HigherGovConfig,
} from '@/helpers/highergov';
import { getOpportunity } from '@/helpers/opportunity';
import { listRelatedRfps } from '@/helpers/related-rfp';
import { AGENCY_FETCH_PAGE_SIZE } from '@/constants/related-rfp';
import { buildAgencyLabel, type AgencyHistoryItem } from '@auto-rfp/core';

const httpsAgent = new https.Agent({ keepAlive: true });

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const { orgId, projectId, oppId, q } = event.queryStringParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });
  if (!oppId) return apiResponse(400, { message: 'oppId is required' });

  const found = await getOpportunity({ orgId, projectId, oppId });
  const opp = found?.item;
  if (!opp) return apiResponse(404, { message: 'Opportunity not found' });
  if (!opp.higherGovOppKey) return apiResponse(200, { items: [] });

  const apiKey = await getApiKey(orgId, HIGHERGOV_SECRET_PREFIX);
  if (!apiKey) return apiResponse(200, { items: [] });

  const cfg: HigherGovConfig = { baseUrl: HIGHERGOV_BASE_URL, apiKey, httpsAgent };

  // Resolve agency_key (not stored on our record).
  const source = await fetchHigherGovOpportunity(cfg, opp.higherGovOppKey);
  const agencyKey = source.agency?.agency_key != null ? String(source.agency.agency_key) : undefined;
  if (!agencyKey) return apiResponse(200, { items: [] });

  const { results } = await searchHigherGovOpportunities(cfg, {
    agencyKey,
    keywords: q?.trim() || undefined,
    pageSize: AGENCY_FETCH_PAGE_SIZE,
  });

  const relatedKeys = new Set(
    (await listRelatedRfps(orgId, projectId, oppId)).map((r) => r.relatedOppKey),
  );

  const items: AgencyHistoryItem[] = results
    .filter((c) => c.opp_key !== opp.higherGovOppKey)
    .map((c) => ({
      relatedOppKey:    c.opp_key,
      title:            c.title ?? 'Untitled',
      organizationName: buildAgencyLabel(c.agency),
      postedDateIso:    c.posted_date ?? null,
      dueDateIso:       c.due_date ?? null,
      sourceUrl:        c.source_path ?? c.path ?? null,
      linkedOpportunityId: null,
      alreadyRelated:   relatedKeys.has(c.opp_key),
    }));

  return apiResponse(200, { items });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);

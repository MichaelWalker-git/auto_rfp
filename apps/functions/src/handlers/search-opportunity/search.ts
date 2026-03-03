/**
 * Unified search handler.
 * POST /search-opportunities/search
 *
 * Body: { source?: 'SAM_GOV' | 'DIBBS' | 'ALL', orgId, keywords, postedFrom, postedTo, ... }
 * Searches the specified source (or all sources if source = 'ALL' / omitted).
 * Returns SearchOpportunitySlim[] with a source badge on each result.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';
import { z } from 'zod';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { getApiKey } from '@/helpers/api-key-storage';
import { SAM_GOV_SECRET_PREFIX } from '@/constants/samgov';
import { DIBBS_SECRET_PREFIX } from '@/constants/dibbs';
import { requireEnv } from '@/helpers/env';
import { searchSamOpportunities } from '@/helpers/search-opportunity';
import { searchDibbsOpportunities } from '@/helpers/search-opportunity';
import {
  samSlimToSearchOpportunity,
  dibbsSlimToSearchOpportunity,
  type SearchOpportunitySlim,
} from '@auto-rfp/core';

const SAM_BASE_URL  = requireEnv('SAM_OPPS_BASE_URL', 'https://api.sam.gov');
const DIBBS_BASE_URL = requireEnv('DIBBS_BASE_URL', 'https://www.dibbs.bsm.dla.mil');
const httpsAgent = new https.Agent({ keepAlive: true });

// ─── Request schema ───────────────────────────────────────────────────────────

const MmDdYyyy = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Expected MM/dd/yyyy');

const SearchRequestSchema = z.object({
  /** Which source(s) to search. Omit or use 'ALL' to search all configured sources. */
  source:       z.enum(['SAM_GOV', 'DIBBS', 'ALL']).default('ALL'),
  keywords:     z.string().min(1).optional(),
  naics:        z.array(z.string().min(2)).optional(),
  setAsideCode: z.string().optional(),
  postedFrom:   MmDdYyyy.optional(),
  postedTo:     MmDdYyyy.optional(),
  /** Response-deadline / closing date from (MM/dd/yyyy). SAM.gov: rdlfrom. DIBBS: closingFrom. */
  closingFrom:  MmDdYyyy.optional(),
  /** Response-deadline / closing date to (MM/dd/yyyy). DIBBS: closingTo. */
  closingTo:    MmDdYyyy.optional(),
  limit:  z.number().int().positive().max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

type SearchRequest = z.infer<typeof SearchRequestSchema>;

// ─── Handler ──────────────────────────────────────────────────────────────────

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  let raw: unknown;
  try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON body' }); }

  const { success, data, error } = SearchRequestSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  const includeSam   = data.source === 'ALL' || data.source === 'SAM_GOV';
  const includeDibbs = data.source === 'ALL' || data.source === 'DIBBS';

  const results: SearchOpportunitySlim[] = [];
  const errors: Record<string, string> = {};
  let totalSamGov = 0;
  let totalDibbs  = 0;

  // ── SAM.gov ──────────────────────────────────────────────────────────────
  if (includeSam) {
    try {
      const apiKey = await getApiKey(orgId, SAM_GOV_SECRET_PREFIX);
      if (apiKey) {
        const resp = await searchSamOpportunities(
          { baseUrl: SAM_BASE_URL, apiKey, httpsAgent },
          {
            postedFrom:   data.postedFrom ?? '01/01/2025',
            postedTo:     data.postedTo   ?? '12/31/2025',
            // closingFrom maps to SAM.gov rdlfrom (response deadline from)
            rdlfrom:      data.closingFrom,
            keywords:     data.keywords,
            naics:        data.naics,
            setAsideCode: data.setAsideCode,
            limit:        data.limit ?? 25,
            offset:       data.offset ?? 0,
          },
        );
        totalSamGov = resp.totalRecords;
        results.push(...resp.opportunities.map(samSlimToSearchOpportunity));
      }
    } catch (e) {
      errors['SAM_GOV'] = e instanceof Error ? e.message : 'SAM.gov search failed';
    }
  }

  // ── DIBBS ─────────────────────────────────────────────────────────────────
  if (includeDibbs) {
    try {
      const apiKey = await getApiKey(orgId, DIBBS_SECRET_PREFIX);
      if (apiKey) {
        const resp = await searchDibbsOpportunities(
          { baseUrl: DIBBS_BASE_URL, apiKey, httpsAgent },
          {
            keywords:    data.keywords,
            naics:       data.naics,
            postedFrom:  data.postedFrom,
            postedTo:    data.postedTo,
            closingFrom: data.closingFrom,
            closingTo:   data.closingTo,
            limit:       data.limit ?? 25,
            offset:      data.offset ?? 0,
          },
        );
        totalDibbs = resp.totalRecords;
        results.push(...resp.opportunities.map(dibbsSlimToSearchOpportunity));
      }
    } catch (e) {
      errors['DIBBS'] = e instanceof Error ? e.message : 'DIBBS search failed';
    }
  }

  // Interleave SAM.gov and DIBBS results for balanced display
  const samResults   = results.filter((r) => r.source === 'SAM_GOV');
  const dibbsResults = results.filter((r) => r.source === 'DIBBS');
  const merged: SearchOpportunitySlim[] = [];
  const maxLen = Math.max(samResults.length, dibbsResults.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < samResults.length)   merged.push(samResults[i]!);
    if (i < dibbsResults.length) merged.push(dibbsResults[i]!);
  }

  return apiResponse(200, {
    opportunities: merged,
    totalSamGov,
    totalDibbs,
    total: totalSamGov + totalDibbs,
    errors: Object.keys(errors).length ? errors : undefined,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);

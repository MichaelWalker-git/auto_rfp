import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

import {
  type LoadSamOpportunitiesRequest,
  LoadSamOpportunitiesRequestSchema,
  type LoadSamOpportunitiesResponse,
  type SamOpportunitySlim,
} from '@auto-rfp/shared';

import { readPlainSecret } from '../helpers/secret';

// ---------------- env ----------------
const SAM_BASE_URL = requireEnv('SAM_OPPS_BASE_URL', 'https://api.sam.gov');
const SAM_GOV_API_KEY_SECRET_ID = requireEnv('SAM_GOV_API_KEY_SECRET_ID');

const DEFAULT_LIMIT = Number(requireEnv('SAM_OPPS_DEFAULT_LIMIT', '25'));
const DEFAULT_OFFSET = Number(requireEnv('SAM_OPPS_DEFAULT_OFFSET', '0'));

// ---------------- helpers ----------------
function addQueryParam(url: URL, key: string, value: any) {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    for (const v of value) {
      const s = String(v ?? '').trim();
      if (s) url.searchParams.append(key, s);
    }
    return;
  }

  const s = String(value ?? '').trim();
  if (s) url.searchParams.set(key, s);
}

function clampLimit(n: number | undefined) {
  const v = Number(n ?? DEFAULT_LIMIT);
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_LIMIT;
  return Math.min(1000, Math.floor(v));
}

function clampOffset(n: number | undefined) {
  const v = Number(n ?? DEFAULT_OFFSET);
  if (!Number.isFinite(v) || v < 0) return DEFAULT_OFFSET;
  return Math.floor(v);
}

async function httpsGetJson(url: URL): Promise<any> {
  const bodyStr = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        method: 'GET',
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: { Accept: 'application/json' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(text);
          else reject(new Error(`SAM.gov error: ${res.statusCode} ${res.statusMessage} - ${text}`));
        });
      },
    );
    req.on('error', reject);
    req.end();
  });

  return JSON.parse(bodyStr);
}

function toNumber(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toSlim(o: any): SamOpportunitySlim {
  const baseAndAllOptionsValue =
    toNumber(o?.baseAndAllOptionsValue) ??
    toNumber(o?.baseAndAllOptions?.value) ??
    toNumber(o?.award?.amount);

  return {
    noticeId: o?.noticeId ?? o?.noticeid,
    solicitationNumber: o?.solicitationNumber ?? o?.solnum,
    title: o?.title,
    type: o?.type,
    postedDate: o?.postedDate,
    responseDeadLine: o?.responseDeadLine ?? o?.reponseDeadLine,
    naicsCode: o?.naicsCode ?? o?.ncode,
    classificationCode: o?.classificationCode ?? o?.ccode,
    active: o?.active,
    setAside: o?.setAside,
    setAsideCode: o?.setAsideCode,
    fullParentPathName: o?.fullParentPathName,
    fullParentPathCode: o?.fullParentPathCode,
    description: o?.description,
    baseAndAllOptionsValue,
    award: o?.award,
  };
}

function filterByDollarRange(items: SamOpportunitySlim[], range?: { min?: number; max?: number }) {
  if (!range) return items;
  const min = range.min;
  const max = range.max;

  return items.filter((it) => {
    const v = it.baseAndAllOptionsValue;
    if (v == null) return true; // don’t drop if value missing
    if (min != null && v < min) return false;
    if (max != null && v > max) return false;
    return true;
  });
}

// ---------------- handler ----------------
export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) return apiResponse(400, { message: 'Request body is required' });

    let raw: unknown;
    try {
      raw = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON body' });
    }

    const parsed = LoadSamOpportunitiesRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return apiResponse(400, { message: 'Validation error', errors: parsed.error.format() });
    }

    const body: LoadSamOpportunitiesRequest = parsed.data;

    const limit = clampLimit(body.limit);
    const offset = clampOffset(body.offset);

    // SAM opportunities search
    const url = new URL('/opportunities/v2/search', SAM_BASE_URL);

    const apiKey = await readPlainSecret(SAM_GOV_API_KEY_SECRET_ID);
    addQueryParam(url, 'api_key', apiKey);

    // required
    addQueryParam(url, 'postedFrom', body.postedFrom);
    addQueryParam(url, 'postedTo', body.postedTo);

    // --- Search criteria mapping ---
    // NAICS: SAM uses ncode; repeat param allowed
    if (body.naics?.length) addQueryParam(url, 'ncode', body.naics);

    // PSC: SAM uses ccode; repeat param allowed
    if (body.psc?.length) addQueryParam(url, 'ccode', body.psc);

    // Keywords: SAM supports title. We also allow "keywords" and map to title when title missing.
    const titleQuery = body.title ?? body.keywords;
    if (titleQuery) addQueryParam(url, 'title', titleQuery);

    // Agency
    addQueryParam(url, 'organizationCode', body.organizationCode);
    addQueryParam(url, 'organizationName', body.organizationName);

    // Set-aside (varies; pass through as setAsideCode if present)
    addQueryParam(url, 'setAsideCode', body.setAsideCode);

    // Notice/procurement type
    addQueryParam(url, 'ptype', body.ptype);

    // Location
    addQueryParam(url, 'state', body.state);
    addQueryParam(url, 'zip', body.zip);

    // paging
    addQueryParam(url, 'limit', String(limit));
    addQueryParam(url, 'offset', String(offset));

    const json = await httpsGetJson(url);

    const totalRecords = Number(json?.totalRecords ?? 0) || 0;
    const respLimit = Number(json?.limit ?? limit) || limit;
    const respOffset = Number(json?.offset ?? offset) || offset;

    const rawList: any[] =
      (Array.isArray(json?.opportunitiesData) && json.opportunitiesData) ||
      (Array.isArray(json?.data) && json.data) ||
      (Array.isArray(json?.results) && json.results) ||
      [];

    let opportunities = rawList.map(toSlim);

    // Dollar range: not always filterable server-side, so we do safe client-side filter.
    opportunities = filterByDollarRange(opportunities, body.dollarRange);

    const resp: LoadSamOpportunitiesResponse = {
      totalRecords,
      limit: respLimit,
      offset: respOffset,
      opportunities,
    };

    return apiResponse(200, resp);
  } catch (err: any) {
    console.error('Error in SAM search handler:', err);
    return apiResponse(500, {
      message: 'Failed to search opportunities from SAM.gov',
      error: err instanceof Error ? err.message : 'Unknown error',
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

import https from 'https';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, createItem, deleteItem, queryBySkPrefix, getItem } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { DIBBS_SAVED_SEARCH_PK } from '@/constants/dibbs';
import type {
  DibbsOpportunitySlim,
  DibbsSavedSearch,
  SearchDibbsOpportunitiesRequest,
  SearchDibbsOpportunitiesResponse,
} from '@auto-rfp/core';
import { DibbsSavedSearchSchema } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── Types ────────────────────────────────────────────────────────────────────

export type DibbsSearchConfig = {
  baseUrl: string;
  apiKey: string;
  httpsAgent?: https.Agent;
};

export type DibbsAttachment = { url: string; name?: string; mimeType?: string };

// ─── Internal HTTP helper ─────────────────────────────────────────────────────

const httpsGetJson = async (url: URL, agent?: https.Agent): Promise<unknown> => {
  const bodyStr = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        method: 'GET',
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: { Accept: 'application/json' },
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(text);
          else reject(new Error(`DIBBS error: ${res.statusCode} - ${text}`));
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
  return JSON.parse(bodyStr);
};

// ─── Normalise raw DIBBS record to DibbsOpportunitySlim ──────────────────────

const toSlim = (o: Record<string, unknown>): DibbsOpportunitySlim => ({
  solicitationNumber:     (o.solicitationNumber ?? o.solNum) as string | undefined,
  title:                  (o.title ?? o.description_title) as string | undefined,
  type:                   (o.type ?? o.solicitationType) as string | undefined,
  postedDate:             (o.postedDate ?? o.posted_date) as string | undefined,
  closingDate:            (o.closingDate ?? o.responseDeadLine) as string | undefined,
  naicsCode:              (o.naicsCode ?? o.naics) as string | undefined,
  pscCode:                (o.pscCode ?? o.classificationCode) as string | undefined,
  dodComponent:           (o.dodComponent ?? o.agency) as string | undefined,
  contractVehicle:        (o.contractVehicle ?? o.vehicle) as string | undefined,
  technologyArea:         (o.technologyArea ?? o.tech_area) as string | undefined,
  setAside:               o.setAside as string | undefined,
  setAsideCode:           o.setAsideCode as string | undefined,
  description:            (o.description ?? o.synopsis) as string | undefined,
  active:                 (o.active ?? o.status) as string | boolean | undefined,
  baseAndAllOptionsValue: typeof o.baseAndAllOptionsValue === 'number' ? o.baseAndAllOptionsValue : undefined,
  attachmentsCount:       Array.isArray(o.attachments) ? (o.attachments as unknown[]).length : 0,
  url:                    (o.url ?? o.link) as string | undefined,
});

// ─── Search ───────────────────────────────────────────────────────────────────

export const searchDibbsOpportunities = async (
  cfg: DibbsSearchConfig,
  body: SearchDibbsOpportunitiesRequest,
): Promise<SearchDibbsOpportunitiesResponse> => {
  const limit  = Math.min(body.limit  ?? 25, 200);
  const offset = Math.max(body.offset ?? 0,  0);

  const url = new URL('/api/v1/solicitations/search', cfg.baseUrl);
  url.searchParams.set('api_key', cfg.apiKey);
  if (body.keywords)           url.searchParams.set('q',            body.keywords);
  if (body.solicitationNumber) url.searchParams.set('solNum',        body.solicitationNumber);
  if (body.setAsideCode)       url.searchParams.set('setAsideCode',  body.setAsideCode);
  if (body.postedFrom)         url.searchParams.set('postedFrom',    body.postedFrom);
  if (body.postedTo)           url.searchParams.set('postedTo',      body.postedTo);
  if (body.closingFrom)        url.searchParams.set('closingFrom',   body.closingFrom);
  if (body.closingTo)          url.searchParams.set('closingTo',     body.closingTo);
  for (const v of body.technologyAreas  ?? []) url.searchParams.append('technologyArea',  v);
  for (const v of body.dodComponents    ?? []) url.searchParams.append('dodComponent',    v);
  for (const v of body.contractVehicles ?? []) url.searchParams.append('vehicle',         v);
  for (const v of body.innovationTopics ?? []) url.searchParams.append('innovationTopic', v);
  for (const v of body.naics            ?? []) url.searchParams.append('naics',           v);
  for (const v of body.psc              ?? []) url.searchParams.append('psc',             v);
  url.searchParams.set('limit',  String(limit));
  url.searchParams.set('offset', String(offset));

  const json = await httpsGetJson(url, cfg.httpsAgent) as Record<string, unknown>;
  const totalRecords = Number(json?.totalRecords ?? json?.total ?? 0) || 0;
  const rawList: Record<string, unknown>[] =
    (Array.isArray(json?.data)          ? json.data          as Record<string, unknown>[] : null) ??
    (Array.isArray(json?.solicitations) ? json.solicitations as Record<string, unknown>[] : null) ??
    (Array.isArray(json?.results)       ? json.results       as Record<string, unknown>[] : null) ??
    [];

  let opportunities = rawList.map(toSlim);
  if (body.dollarRange) {
    const { min, max } = body.dollarRange;
    opportunities = opportunities.filter((it) => {
      const v = it.baseAndAllOptionsValue;
      if (v == null) return true;
      if (min != null && v < min) return false;
      if (max != null && v > max) return false;
      return true;
    });
  }
  return { totalRecords, limit, offset, opportunities };
};

// ─── Fetch single solicitation ────────────────────────────────────────────────

export const fetchDibbsSolicitation = async (
  cfg: DibbsSearchConfig,
  solicitationNumber: string,
): Promise<Record<string, unknown>> => {
  const url = new URL(`/api/v1/solicitations/${encodeURIComponent(solicitationNumber)}`, cfg.baseUrl);
  url.searchParams.set('api_key', cfg.apiKey);
  const json = await httpsGetJson(url, cfg.httpsAgent) as Record<string, unknown>;
  if (!json) throw new Error(`DIBBS returned no data for solicitationNumber=${solicitationNumber}`);
  return json;
};

// ─── Extract attachments ──────────────────────────────────────────────────────

export const extractDibbsAttachments = (opp: Record<string, unknown>): DibbsAttachment[] => {
  const out: DibbsAttachment[] = [];
  const attachments = Array.isArray(opp?.attachments)
    ? (opp.attachments as Record<string, unknown>[])
    : [];
  for (const a of attachments) {
    const urlStr = String(a?.url ?? a?.downloadUrl ?? a?.link ?? '').trim();
    if (!urlStr || !/^https?:\/\//i.test(urlStr)) continue;
    out.push({
      url: urlStr,
      name:     a?.fileName ? String(a.fileName) : undefined,
      mimeType: a?.mimeType ? String(a.mimeType) : undefined,
    });
  }
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)));
};

// ─── SK builders ─────────────────────────────────────────────────────────────

export const buildDibbsSavedSearchSK = (orgId: string, savedSearchId: string): string =>
  `${orgId}#${savedSearchId}`;

// ─── DynamoDB helpers ─────────────────────────────────────────────────────────

export const createDibbsSavedSearch = async (
  orgId: string,
  savedSearchId: string,
  item: Omit<DibbsSavedSearch, 'savedSearchId' | 'orgId' | 'createdAt' | 'updatedAt'>,
): Promise<DibbsSavedSearch> => {
  const sk = buildDibbsSavedSearchSK(orgId, savedSearchId);
  return createItem<DibbsSavedSearch>(DIBBS_SAVED_SEARCH_PK, sk, { ...item, savedSearchId, orgId });
};

export const listDibbsSavedSearches = async (orgId: string): Promise<DibbsSavedSearch[]> => {
  const raw = await queryBySkPrefix<Record<string, unknown>>(DIBBS_SAVED_SEARCH_PK, `${orgId}#`);
  const out: DibbsSavedSearch[] = [];
  for (const it of raw) {
    const { success, data } = DibbsSavedSearchSchema.safeParse(it);
    if (success) out.push(data);
  }
  return out;
};

export const getDibbsSavedSearch = async (
  orgId: string,
  savedSearchId: string,
): Promise<DibbsSavedSearch | null> => {
  const sk = buildDibbsSavedSearchSK(orgId, savedSearchId);
  const raw = await getItem<Record<string, unknown>>(DIBBS_SAVED_SEARCH_PK, sk);
  if (!raw) return null;
  const { success, data } = DibbsSavedSearchSchema.safeParse(raw);
  return success ? data : null;
};

export const deleteDibbsSavedSearch = async (orgId: string, savedSearchId: string): Promise<void> => {
  await deleteItem(DIBBS_SAVED_SEARCH_PK, buildDibbsSavedSearchSK(orgId, savedSearchId));
};

export const updateDibbsSavedSearchLastRunAt = async (
  orgId: string,
  savedSearchId: string,
  runAtIso: string,
): Promise<void> => {
  const sk = buildDibbsSavedSearchSK(orgId, savedSearchId);
  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: DIBBS_SAVED_SEARCH_PK, [SK_NAME]: sk },
      UpdateExpression: 'SET #lastRunAt = :t, #updatedAt = :t',
      ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
      ExpressionAttributeNames: {
        '#pk':        PK_NAME,
        '#sk':        SK_NAME,
        '#lastRunAt': 'lastRunAt',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: { ':t': runAtIso },
    }),
  );
};

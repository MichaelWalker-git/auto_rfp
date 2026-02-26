# DIBBS Integration — Implementation Document

<!-- SKELETON: sections will be filled in incrementally -->

## 1. Overview <!-- ✅ IMPLEMENTED -->

| Field | Value |
|---|---|
| **Feature** | DIBBS (Defense Industrial Base Bidding System) Integration |
| **Priority** | P2 — Defense market |
| **Estimated Hours** | 12 hours |
| **Domains** | `dibbs` (new), extends `opportunity`, `samgov` patterns |
| **Reference** | Local-docs: "How to Find and Win Contracts on DIBBS" |

DIBBS is the DoD-specific procurement marketplace (distinct from SAM.gov). Defense contractors need both platforms. This feature adds:

1. **DIBBS Search** — search by technology areas, DoD components, contract vehicles, dollar ranges, innovation topics
2. **Opportunity Import** — pull solicitation documents, technical specs, evaluation criteria, submission requirements into the existing pipeline
3. **Saved Searches & Alerts** — configure criteria, email notifications, auto-import, track updates
4. **Unified Dashboard** — DIBBS opportunities flow through the same pipeline as SAM.gov (same `OpportunityItem` shape, same question-file pipeline)
## 2. Architecture Overview <!-- ✅ IMPLEMENTED -->

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                           │
│  features/dibbs/                                                    │
│  ├── hooks/useDibbsSearch.ts        (SWR POST search)              │
│  ├── hooks/useDibbsSavedSearches.ts (SWR GET list)                 │
│  ├── hooks/useDibbsImport.ts        (apiMutate import)             │
│  └── components/DibbsSearchForm.tsx / DibbsResultsTable.tsx        │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTPS (Cognito JWT)
┌──────────────────────────▼──────────────────────────────────────────┐
│                  API Gateway REST (existing)                        │
│  POST /dibbs/search-opportunities                                   │
│  POST /dibbs/import-solicitation                                    │
│  POST /dibbs/create-saved-search                                    │
│  GET  /dibbs/list-saved-search                                      │
│  PATCH /dibbs/edit-saved-search/{id}                                │
│  DELETE /dibbs/delete-saved-search/{id}                             │
│  POST /dibbs/set-api-key                                            │
│  GET  /dibbs/get-api-key                                            │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────────────────┐
│ search Lambda │  │ import Lambda │  │ saved-search Lambdas      │
│ (dibbs/search)│  │(dibbs/import) │  │ (CRUD + run-saved-search) │
└───────┬───────┘  └───────┬───────┘  └───────────────────────────┘
        │                  │
        ▼                  ▼
┌───────────────┐  ┌───────────────────────────────────────────────┐
│  DIBBS API    │  │  S3 (documents) → Question-file pipeline      │
│  (external)   │  │  → OpportunityItem (DynamoDB, source=DIBBS)   │
└───────────────┘  └───────────────────────────────────────────────┘
        │
┌───────▼───────────────────────────────────────────────────────────┐
│  AWS Secrets Manager  (dibbs-api-key-{orgId})                     │
└───────────────────────────────────────────────────────────────────┘
        │
┌───────▼───────────────────────────────────────────────────────────┐
│  DynamoDB (single table)                                          │
│  PK=DIBBS_SAVED_SEARCH  SK={orgId}#{savedSearchId}               │
└───────────────────────────────────────────────────────────────────┘
```

### Technology Decisions

| Decision | Choice | Reason |
|---|---|---|
| DIBBS API client | Custom `https` module (same as SAM.gov) | No SDK; mirrors existing `helpers/samgov.ts` pattern |
| API key storage | AWS Secrets Manager with prefix `dibbs` | Reuses `api-key-storage.ts`; secret name = `dibbs-api-key-{orgId}` |
| Saved searches | DynamoDB `DIBBS_SAVED_SEARCH` PK | Mirrors `SAVED_SEARCH` PK for SAM.gov |
| Opportunity shape | Reuse `OpportunityItem` with `source: 'DIBBS'` | Unified dashboard; same pipeline |
| Sync scheduler | EventBridge rule → `dibbs/run-saved-search` Lambda | Same pattern as SAM.gov `run-saved-search` |
| Frontend | Feature-Sliced Design under `features/dibbs/` | Mirrors `features/` pattern |
## 3. Data Models & Zod Schemas <!-- ✅ IMPLEMENTED -->

**File:** `packages/core/src/schemas/dibbs.ts`

```typescript
import { z } from 'zod';

// ─── Dollar range (reused from samgov pattern) ───────────────────────────────
export const DibbsDollarRangeSchema = z
  .object({
    min: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
  })
  .optional();

// ─── Search request ──────────────────────────────────────────────────────────
export const SearchDibbsOpportunitiesRequestSchema = z.object({
  // Core filters
  keywords:        z.string().min(1).optional(),
  technologyAreas: z.array(z.string().min(1)).optional(), // e.g. ["AI/ML", "Cyber"]
  dodComponents:   z.array(z.string().min(1)).optional(), // e.g. ["Army", "Navy", "DARPA"]
  contractVehicles:z.array(z.string().min(1)).optional(), // e.g. ["SBIR", "STTR", "OTA"]
  innovationTopics:z.array(z.string().min(1)).optional(),
  solicitationNumber: z.string().min(1).optional(),
  setAsideCode:    z.string().optional(),
  naics:           z.array(z.string().min(2)).optional(),
  psc:             z.array(z.string().min(2)).optional(),

  // Date filters (MM/dd/yyyy — same convention as SAM.gov)
  postedFrom: z
    .string()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Expected MM/dd/yyyy')
    .optional(),
  postedTo: z
    .string()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Expected MM/dd/yyyy')
    .optional(),
  closingFrom: z
    .string()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Expected MM/dd/yyyy')
    .optional(),
  closingTo: z
    .string()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Expected MM/dd/yyyy')
    .optional(),

  dollarRange: DibbsDollarRangeSchema,

  // Pagination
  limit:  z.number().int().positive().max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export type SearchDibbsOpportunitiesRequest = z.infer<typeof SearchDibbsOpportunitiesRequestSchema>;

// ─── Single opportunity (slim, from DIBBS search results) ────────────────────
export const DibbsOpportunitySlimSchema = z.object({
  solicitationNumber: z.string().optional(),
  title:              z.string().optional(),
  type:               z.string().optional(),   // "SOLICITATION", "PRESOLICITATION", etc.
  postedDate:         z.string().optional(),
  closingDate:        z.string().optional(),
  naicsCode:          z.string().optional(),
  pscCode:            z.string().optional(),
  dodComponent:       z.string().optional(),   // "Army", "Navy", "DARPA", etc.
  contractVehicle:    z.string().optional(),   // "SBIR Phase I", "OTA", etc.
  technologyArea:     z.string().optional(),
  setAside:           z.string().optional(),
  setAsideCode:       z.string().optional(),
  description:        z.string().optional(),
  active:             z.union([z.string(), z.boolean()]).optional(),
  baseAndAllOptionsValue: z.number().optional(),
  attachmentsCount:   z.number().int().nonnegative().optional(),
  url:                z.string().url().optional(), // direct link on DIBBS portal
});

export type DibbsOpportunitySlim = z.infer<typeof DibbsOpportunitySlimSchema>;

// ─── Search response ─────────────────────────────────────────────────────────
export const SearchDibbsOpportunitiesResponseSchema = z.object({
  totalRecords:  z.number().int().nonnegative(),
  limit:         z.number().int().nonnegative(),
  offset:        z.number().int().nonnegative(),
  opportunities: z.array(DibbsOpportunitySlimSchema),
});

export type SearchDibbsOpportunitiesResponse = z.infer<typeof SearchDibbsOpportunitiesResponseSchema>;

// ─── Import request ──────────────────────────────────────────────────────────
export const ImportDibbsSolicitationRequestSchema = z.object({
  orgId:              z.string().min(1),
  projectId:          z.string().min(1),
  solicitationNumber: z.string().min(1),
  sourceDocumentId:   z.string().optional(),
});

export type ImportDibbsSolicitationRequest = z.infer<typeof ImportDibbsSolicitationRequestSchema>;

// ─── Saved search ─────────────────────────────────────────────────────────────
export const DibbsSavedSearchFrequencySchema = z.enum(['HOURLY', 'DAILY', 'WEEKLY']);
export type DibbsSavedSearchFrequency = z.infer<typeof DibbsSavedSearchFrequencySchema>;

export const DibbsSavedSearchSchema = z.object({
  savedSearchId: z.string().min(1),
  orgId:         z.string().min(1),
  name:          z.string().min(1).max(120),
  criteria:      SearchDibbsOpportunitiesRequestSchema,
  frequency:     DibbsSavedSearchFrequencySchema.default('DAILY'),
  autoImport:    z.boolean().default(false),
  notifyEmails:  z.array(z.string().email()).default([]),
  isEnabled:     z.boolean().default(true),
  lastRunAt:     z.string().datetime().nullable().default(null),
  createdAt:     z.string().datetime(),
  updatedAt:     z.string().datetime(),
});

export type DibbsSavedSearch = z.infer<typeof DibbsSavedSearchSchema>;

// ─── Create saved search DTO ──────────────────────────────────────────────────
export const CreateDibbsSavedSearchRequestSchema = z.object({
  orgId:        z.string().min(1),
  name:         z.string().min(1).max(120),
  criteria:     SearchDibbsOpportunitiesRequestSchema,
  frequency:    DibbsSavedSearchFrequencySchema.optional(),
  autoImport:   z.boolean().optional(),
  notifyEmails: z.array(z.string().email()).optional(),
  isEnabled:    z.boolean().optional(),
});

export type CreateDibbsSavedSearchRequest = z.infer<typeof CreateDibbsSavedSearchRequestSchema>;

// ─── Patch saved search DTO ───────────────────────────────────────────────────
export const PatchDibbsSavedSearchSchema = z
  .object({
    name:         z.string().min(1).max(120).optional(),
    criteria:     SearchDibbsOpportunitiesRequestSchema.optional(),
    frequency:    DibbsSavedSearchFrequencySchema.optional(),
    autoImport:   z.boolean().optional(),
    notifyEmails: z.array(z.string().email()).optional(),
    isEnabled:    z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Patch body must not be empty' });

export type PatchDibbsSavedSearch = z.infer<typeof PatchDibbsSavedSearchSchema>;
```

**Also update** `packages/core/src/schemas/index.ts` — add at the end:

```typescript
export * from './dibbs';
```

**Also update** `packages/core/src/schemas/opportunity.ts` — extend `OpportunitySourceSchema`:

```typescript
// Before:
export const OpportunitySourceSchema = z.enum(['SAM_GOV', 'MANUAL_UPLOAD']);

// After:
export const OpportunitySourceSchema = z.enum(['SAM_GOV', 'DIBBS', 'MANUAL_UPLOAD']);
```
## 4. DynamoDB Design <!-- ✅ IMPLEMENTED -->

### 4.1 PK Constants

**File:** `apps/functions/src/constants/dibbs.ts`

```typescript
export const DIBBS_SAVED_SEARCH_PK = 'DIBBS_SAVED_SEARCH';
export const DIBBS_SECRET_PREFIX    = 'dibbs';
```

### 4.2 Access Pattern Table

| Entity | PK | SK | Notes |
|---|---|---|---|
| DIBBS Saved Search | `DIBBS_SAVED_SEARCH` | `{orgId}#{savedSearchId}` | List by org: `begins_with(SK, "{orgId}#")` |

> DIBBS opportunities are stored as `OpportunityItem` records (same table, same PK as SAM.gov opportunities — `source: 'DIBBS'` distinguishes them). No new PK needed for opportunities.

### 4.3 SK Builder Functions

**File:** `apps/functions/src/helpers/dibbs.ts` (partial — SK builders)

```typescript
// ─── SK builders ─────────────────────────────────────────────────────────────

export const buildDibbsSavedSearchSK = (orgId: string, savedSearchId: string): string =>
  `${orgId}#${savedSearchId}`;
```

### 4.4 DynamoDB Helper Functions

**File:** `apps/functions/src/helpers/dibbs.ts` (continued)

```typescript
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, createItem, putItem, deleteItem, queryBySkPrefix } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { DIBBS_SAVED_SEARCH_PK } from '@/constants/dibbs';
import { DibbsSavedSearch, DibbsSavedSearchSchema } from '@auto-rfp/core';
import { nowIso } from '@/helpers/date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── Saved search helpers ─────────────────────────────────────────────────────

export const createDibbsSavedSearch = async (
  orgId: string,
  savedSearchId: string,
  item: Omit<DibbsSavedSearch, 'savedSearchId' | 'orgId' | 'createdAt' | 'updatedAt'>,
): Promise<DibbsSavedSearch> => {
  const sk = buildDibbsSavedSearchSK(orgId, savedSearchId);
  const result = await createItem<DibbsSavedSearch>(
    DIBBS_SAVED_SEARCH_PK,
    sk,
    { ...item, savedSearchId, orgId },
  );
  return result;
};

export const listDibbsSavedSearches = async (
  orgId: string,
): Promise<DibbsSavedSearch[]> => {
  const raw = await queryBySkPrefix<Record<string, unknown>>(
    DIBBS_SAVED_SEARCH_PK,
    `${orgId}#`,
  );
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
  const { getItem } = await import('@/helpers/db');
  const sk = buildDibbsSavedSearchSK(orgId, savedSearchId);
  const raw = await getItem<Record<string, unknown>>(DIBBS_SAVED_SEARCH_PK, sk);
  if (!raw) return null;
  const { success, data } = DibbsSavedSearchSchema.safeParse(raw);
  return success ? data : null;
};

export const deleteDibbsSavedSearch = async (
  orgId: string,
  savedSearchId: string,
): Promise<void> => {
  const sk = buildDibbsSavedSearchSK(orgId, savedSearchId);
  await deleteItem(DIBBS_SAVED_SEARCH_PK, sk);
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
        '#pk': PK_NAME,
        '#sk': SK_NAME,
        '#lastRunAt': 'lastRunAt',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: { ':t': runAtIso },
    }),
  );
};
```
## 5. Backend — Lambda Handlers <!-- ✅ IMPLEMENTED -->

### 5.1 File Structure

```
apps/functions/src/
├── constants/dibbs.ts
├── helpers/dibbs.ts
└── handlers/dibbs/
    ├── search-opportunities.ts
    ├── import-solicitation.ts
    ├── set-api-key.ts
    ├── get-api-key.ts
    ├── create-saved-search.ts
    ├── list-saved-search.ts
    ├── edit-saved-search.ts
    ├── delete-saved-search.ts
    └── run-saved-search.ts
```

### 5.2 DIBBS API Client (`apps/functions/src/helpers/dibbs.ts`)

```typescript
import https from 'https';
import type {
  SearchDibbsOpportunitiesRequest,
  SearchDibbsOpportunitiesResponse,
  DibbsOpportunitySlim,
} from '@auto-rfp/core';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, createItem, deleteItem, queryBySkPrefix, getItem } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { DIBBS_SAVED_SEARCH_PK } from '@/constants/dibbs';
import { DibbsSavedSearch, DibbsSavedSearchSchema } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── Types ────────────────────────────────────────────────────────────────────

export type DibbsSearchConfig = {
  baseUrl: string;
  apiKey: string;
  httpsAgent?: https.Agent;
};

export type DibbsAttachment = { url: string; name?: string; mimeType?: string };

// ─── HTTP helper ──────────────────────────────────────────────────────────────

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

// ─── Normalise raw record ─────────────────────────────────────────────────────

const toSlim = (o: Record<string, unknown>): DibbsOpportunitySlim => ({
  solicitationNumber: (o.solicitationNumber ?? o.solNum) as string | undefined,
  title:              (o.title ?? o.description_title) as string | undefined,
  type:               (o.type ?? o.solicitationType) as string | undefined,
  postedDate:         (o.postedDate ?? o.posted_date) as string | undefined,
  closingDate:        (o.closingDate ?? o.responseDeadLine) as string | undefined,
  naicsCode:          (o.naicsCode ?? o.naics) as string | undefined,
  pscCode:            (o.pscCode ?? o.classificationCode) as string | undefined,
  dodComponent:       (o.dodComponent ?? o.agency) as string | undefined,
  contractVehicle:    (o.contractVehicle ?? o.vehicle) as string | undefined,
  technologyArea:     (o.technologyArea ?? o.tech_area) as string | undefined,
  setAside:           o.setAside as string | undefined,
  setAsideCode:       o.setAsideCode as string | undefined,
  description:        (o.description ?? o.synopsis) as string | undefined,
  active:             (o.active ?? o.status) as string | boolean | undefined,
  baseAndAllOptionsValue: typeof o.baseAndAllOptionsValue === 'number' ? o.baseAndAllOptionsValue : undefined,
  attachmentsCount:   Array.isArray(o.attachments) ? (o.attachments as unknown[]).length : 0,
  url:                (o.url ?? o.link) as string | undefined,
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
  for (const v of body.technologyAreas  ?? []) url.searchParams.append('technologyArea', v);
  for (const v of body.dodComponents    ?? []) url.searchParams.append('dodComponent',   v);
  for (const v of body.contractVehicles ?? []) url.searchParams.append('vehicle',        v);
  for (const v of body.innovationTopics ?? []) url.searchParams.append('innovationTopic',v);
  for (const v of body.naics            ?? []) url.searchParams.append('naics',          v);
  for (const v of body.psc              ?? []) url.searchParams.append('psc',            v);
  url.searchParams.set('limit',  String(limit));
  url.searchParams.set('offset', String(offset));

  const json = await httpsGetJson(url, cfg.httpsAgent) as Record<string, unknown>;
  const totalRecords = Number(json?.totalRecords ?? json?.total ?? 0) || 0;
  const rawList: Record<string, unknown>[] =
    (Array.isArray(json?.data)          ? json.data          : null) ??
    (Array.isArray(json?.solicitations) ? json.solicitations : null) ??
    (Array.isArray(json?.results)       ? json.results       : null) ??
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
  const attachments = Array.isArray(opp?.attachments) ? opp.attachments as Record<string, unknown>[] : [];
  for (const a of attachments) {
    const urlStr = String(a?.url ?? a?.downloadUrl ?? a?.link ?? '').trim();
    if (!urlStr || !/^https?:\/\//i.test(urlStr)) continue;
    out.push({ url: urlStr, name: a?.fileName ? String(a.fileName) : undefined, mimeType: a?.mimeType ? String(a.mimeType) : undefined });
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
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME, '#lastRunAt': 'lastRunAt', '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: { ':t': runAtIso },
    }),
  );
};
```
### 5.3 `handlers/dibbs/search-opportunities.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, requirePermission } from '@/middleware/rbac-middleware';
import { SearchDibbsOpportunitiesRequestSchema } from '@auto-rfp/core';
import { searchDibbsOpportunities } from '@/helpers/dibbs';
import { getApiKey } from '@/helpers/api-key-storage';
import { DIBBS_SECRET_PREFIX } from '@/constants/dibbs';

const DIBBS_BASE_URL = requireEnv('DIBBS_BASE_URL', 'https://www.dibbs.bsm.dla.mil');
const httpsAgent = new https.Agent({ keepAlive: true });

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  let raw: unknown;
  try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON body' }); }

  const { success, data, error } = SearchDibbsOpportunitiesRequestSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  const apiKey = await getApiKey(orgId, DIBBS_SECRET_PREFIX);
  if (!apiKey) return apiResponse(404, { message: 'DIBBS API key not configured for this organization' });

  const resp = await searchDibbsOpportunities({ baseUrl: DIBBS_BASE_URL, apiKey, httpsAgent }, data);
  return apiResponse(200, resp);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);
```

### 5.4 `handlers/dibbs/import-solicitation.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, requirePermission, type AuthedEvent } from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { ImportDibbsSolicitationRequestSchema } from '@auto-rfp/core';
import { fetchDibbsSolicitation, extractDibbsAttachments, type DibbsSearchConfig } from '@/helpers/dibbs';
import { getApiKey } from '@/helpers/api-key-storage';
import { DIBBS_SECRET_PREFIX } from '@/constants/dibbs';
import { uploadToS3 } from '@/helpers/s3';
import { createOpportunity } from '@/helpers/opportunity';
import { createQuestionFile } from '@/helpers/questionFile';
import { startPipeline } from '@/helpers/solicitation';
import { httpsGetBuffer, guessContentType, buildAttachmentFilename, buildAttachmentS3Key } from '@/helpers/samgov';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const DIBBS_BASE_URL   = requireEnv('DIBBS_BASE_URL', 'https://www.dibbs.bsm.dla.mil');
const httpsAgent = new https.Agent({ keepAlive: true });

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  let raw: unknown;
  try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON body' }); }

  const { success, data, error } = ImportDibbsSolicitationRequestSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  const { orgId, projectId, solicitationNumber, sourceDocumentId } = data;

  const apiKey = await getApiKey(orgId, DIBBS_SECRET_PREFIX);
  if (!apiKey) return apiResponse(404, { message: 'DIBBS API key not configured for this organization' });

  const cfg: DibbsSearchConfig = { baseUrl: DIBBS_BASE_URL, apiKey, httpsAgent };
  const oppRaw = await fetchDibbsSolicitation(cfg, solicitationNumber);
  const attachments = extractDibbsAttachments(oppRaw);

  const { oppId, item } = await createOpportunity({
    orgId,
    projectId,
    opportunity: {
      orgId,
      projectId,
      source: 'DIBBS',
      id: solicitationNumber,
      title: String(oppRaw?.title ?? 'Untitled'),
      type: (oppRaw?.type ?? null) as string | null,
      postedDateIso: oppRaw?.postedDate ? new Date(String(oppRaw.postedDate)).toISOString() : null,
      responseDeadlineIso: oppRaw?.closingDate ? new Date(String(oppRaw.closingDate)).toISOString() : null,
      noticeId: null,
      solicitationNumber,
      naicsCode: (oppRaw?.naicsCode ?? null) as string | null,
      pscCode: (oppRaw?.pscCode ?? null) as string | null,
      organizationName: (oppRaw?.dodComponent ?? null) as string | null,
      organizationCode: null,
      setAside: (oppRaw?.setAside ?? null) as string | null,
      setAsideCode: (oppRaw?.setAsideCode ?? null) as string | null,
      description: (oppRaw?.description ?? null) as string | null,
      active: true,
      baseAndAllOptionsValue: typeof oppRaw?.baseAndAllOptionsValue === 'number' ? oppRaw.baseAndAllOptionsValue : null,
    },
  });

  const files: Array<{ questionFileId: string; fileKey: string; originalFileName?: string | null; executionArn?: string }> = [];

  for (const a of attachments) {
    const rawFilename = buildAttachmentFilename(a);
    const { buf, contentType } = await httpsGetBuffer(new URL(a.url), { httpsAgent });
    const finalContentType = a.mimeType || contentType || guessContentType(rawFilename);
    const fileKey = buildAttachmentS3Key({ orgId, projectId, noticeId: solicitationNumber, attachmentUrl: a.url, filename: rawFilename });

    await uploadToS3(DOCUMENTS_BUCKET, fileKey, buf, finalContentType ?? 'application/octet-stream');

    const qf = await createQuestionFile(orgId, { oppId, projectId, fileKey, originalFileName: rawFilename, mimeType: finalContentType ?? null, sourceDocumentId });
    const { executionArn } = await startPipeline(projectId, oppId, qf.questionFileId, qf.fileKey, qf.mimeType);

    files.push({ questionFileId: qf.questionFileId, fileKey, originalFileName: rawFilename, executionArn });
  }

  setAuditContext(event, { action: 'CREATED', resource: 'opportunity', resourceId: oppId });

  return apiResponse(202, { ok: true, projectId, solicitationNumber, opportunityId: oppId, imported: files.length, opportunity: item, files });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:create'))
    .use(requirePermission('question:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
```

### 5.5 `handlers/dibbs/set-api-key.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, requirePermission, type AuthedEvent } from '@/middleware/rbac-middleware';
import { storeApiKey } from '@/helpers/api-key-storage';
import { DIBBS_SECRET_PREFIX } from '@/constants/dibbs';
import { z } from 'zod';

const BodySchema = z.object({ orgId: z.string().min(1), apiKey: z.string().min(1) });

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });
  let raw: unknown;
  try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON body' }); }

  const { success, data, error } = BodySchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  await storeApiKey(data.orgId, DIBBS_SECRET_PREFIX, data.apiKey);
  return apiResponse(200, { ok: true, orgId: data.orgId });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_settings'))
    .use(httpErrorMiddleware()),
);
```

### 5.6 `handlers/dibbs/get-api-key.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, requirePermission } from '@/middleware/rbac-middleware';
import { getApiKey } from '@/helpers/api-key-storage';
import { DIBBS_SECRET_PREFIX } from '@/constants/dibbs';

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  const apiKey = await getApiKey(orgId, DIBBS_SECRET_PREFIX);
  return apiResponse(200, { orgId, apiKey: apiKey ?? null });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_settings'))
    .use(httpErrorMiddleware()),
);
```

### 5.7 `handlers/dibbs/create-saved-search.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, requirePermission, type AuthedEvent } from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { CreateDibbsSavedSearchRequestSchema, DibbsSavedSearchSchema } from '@auto-rfp/core';
import { createDibbsSavedSearch } from '@/helpers/dibbs';
import { nowIso } from '@/helpers/date';

const newId = () => (globalThis.crypto as { randomUUID?: () => string })?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });
  let raw: unknown;
  try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON body' }); }

  const { success, data, error } = CreateDibbsSavedSearchRequestSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  const orgId = data.orgId;
  const savedSearchId = newId();
  const now = nowIso();

  const candidate = {
    savedSearchId, orgId,
    name: data.name.trim(),
    criteria: data.criteria,
    frequency: data.frequency ?? 'DAILY',
    autoImport: data.autoImport ?? false,
    notifyEmails: data.notifyEmails ?? [],
    isEnabled: data.isEnabled ?? true,
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  } as const;

  const { success: vs, data: validated, error: ve } = DibbsSavedSearchSchema.safeParse(candidate);
  if (!vs) return apiResponse(400, { message: 'Internal validation error', issues: ve.issues });

  await createDibbsSavedSearch(orgId, savedSearchId, validated);
  setAuditContext(event, { action: 'CONFIG_CHANGED', resource: 'config', resourceId: savedSearchId });
  return apiResponse(200, validated);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
```

### 5.8 `handlers/dibbs/list-saved-search.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, requirePermission } from '@/middleware/rbac-middleware';
import { listDibbsSavedSearches } from '@/helpers/dibbs';

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const { orgId } = event.queryStringParameters ?? {};
  const resolvedOrgId = orgId ?? (event as { auth?: { orgId?: string } }).auth?.orgId;
  if (!resolvedOrgId) return apiResponse(400, { message: 'orgId is required' });

  const items = await listDibbsSavedSearches(resolvedOrgId);
  return apiResponse(200, { items, count: items.length });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);
```

### 5.9 `handlers/dibbs/edit-saved-search.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, requirePermission, type AuthedEvent } from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { PatchDibbsSavedSearchSchema } from '@auto-rfp/core';
import { getDibbsSavedSearch } from '@/helpers/dibbs';
import { updateItem } from '@/helpers/db';
import { DIBBS_SAVED_SEARCH_PK } from '@/constants/dibbs';
import { buildDibbsSavedSearchSK } from '@/helpers/dibbs';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const savedSearchId = event.pathParameters?.id;
  if (!savedSearchId) return apiResponse(400, { message: 'savedSearchId path param is required' });

  const { orgId } = event.queryStringParameters ?? {};
  const resolvedOrgId = orgId ?? (event as { auth?: { orgId?: string } }).auth?.orgId;
  if (!resolvedOrgId) return apiResponse(400, { message: 'orgId is required' });

  if (!event.body) return apiResponse(400, { message: 'Request body is required' });
  let raw: unknown;
  try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON body' }); }

  const { success, data, error } = PatchDibbsSavedSearchSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  const existing = await getDibbsSavedSearch(resolvedOrgId, savedSearchId);
  if (!existing) return apiResponse(404, { message: 'Saved search not found' });

  const sk = buildDibbsSavedSearchSK(resolvedOrgId, savedSearchId);
  const updated = await updateItem(DIBBS_SAVED_SEARCH_PK, sk, data);

  setAuditContext(event, { action: 'CONFIG_CHANGED', resource: 'config', resourceId: savedSearchId });
  return apiResponse(200, updated);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
```

### 5.10 `handlers/dibbs/delete-saved-search.ts`

```typescript
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, requirePermission, type AuthedEvent } from '@/middleware/rbac-middleware';
import { deleteDibbsSavedSearch } from '@/helpers/dibbs';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const savedSearchId = event.pathParameters?.id;
  if (!savedSearchId) return apiResponse(400, { message: 'savedSearchId path param is required' });

  const { orgId } = event.queryStringParameters ?? {};
  const resolvedOrgId = orgId ?? (event as { auth?: { orgId?: string } }).auth?.orgId;
  if (!resolvedOrgId) return apiResponse(400, { message: 'orgId is required' });

  await deleteDibbsSavedSearch(resolvedOrgId, savedSearchId);
  return apiResponse(200, { ok: true, savedSearchId });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:delete'))
    .use(httpErrorMiddleware()),
);
```

### 5.11 `handlers/dibbs/run-saved-search.ts` (EventBridge scheduler)

```typescript
import type { EventBridgeEvent } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';
import { listDibbsSavedSearches, searchDibbsOpportunities, fetchDibbsSolicitation, extractDibbsAttachments, updateDibbsSavedSearchLastRunAt, type DibbsSearchConfig } from '@/helpers/dibbs';
import { getApiKey } from '@/helpers/api-key-storage';
import { DIBBS_SECRET_PREFIX } from '@/constants/dibbs';
import { listAllOrgIds } from '@/helpers/org';
import { createOpportunity } from '@/helpers/opportunity';
import { createQuestionFile } from '@/helpers/questionFile';
import { startPipeline } from '@/helpers/solicitation';
import { uploadToS3 } from '@/helpers/s3';
import { httpsGetBuffer, guessContentType, buildAttachmentFilename, buildAttachmentS3Key } from '@/helpers/samgov';
import { getOrgDefaultProjectId } from '@/handlers/samgov/run-saved-search';
import type { DibbsSavedSearch, SearchDibbsOpportunitiesRequest } from '@auto-rfp/core';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const DIBBS_BASE_URL   = requireEnv('DIBBS_BASE_URL', 'https://www.dibbs.bsm.dla.mil');
const httpsAgent = new https.Agent({ keepAlive: true });

type RunnerEvent = EventBridgeEvent<'dibbs.runSavedSearches', { dryRun?: boolean; orgId?: string }>;

const shouldRunNow = (search: DibbsSavedSearch, now: Date): boolean => {
  if (!search.isEnabled) return false;
  const last = search.lastRunAt ? new Date(search.lastRunAt) : null;
  if (!last) return true;
  const ms = now.getTime() - last.getTime();
  const hour = 3_600_000;
  if (search.frequency === 'HOURLY') return ms >= hour;
  if (search.frequency === 'DAILY')  return ms >= 24 * hour;
  if (search.frequency === 'WEEKLY') return ms >= 7 * 24 * hour;
  return ms >= 24 * hour;
};

const mmddyyyy = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;

export const baseHandler = async (event: RunnerEvent) => {
  const dryRun    = Boolean(event.detail?.dryRun);
  const onlyOrgId = event.detail?.orgId;
  const now       = new Date();
  const ranAtIso  = nowIso();

  const orgIds = onlyOrgId ? [onlyOrgId] : await listAllOrgIds();
  const resultsByOrg: Array<{ orgId: string; results: unknown[] }> = [];

  for (const orgId of orgIds) {
    const apiKey = await getApiKey(orgId, DIBBS_SECRET_PREFIX);
    if (!apiKey) continue;

    const searches   = await listDibbsSavedSearches(orgId);
    const projectId  = await getOrgDefaultProjectId(orgId);
    const cfg: DibbsSearchConfig = { baseUrl: DIBBS_BASE_URL, apiKey, httpsAgent };
    const results: unknown[] = [];

    for (const s of searches) {
      if (!shouldRunNow(s, now)) continue;

      const criteria: SearchDibbsOpportunitiesRequest = {
        ...s.criteria,
        postedFrom: s.lastRunAt ? mmddyyyy(new Date(s.lastRunAt)) : (s.criteria.postedFrom ?? mmddyyyy(new Date(Date.now() - 30 * 86_400_000))),
        postedTo:   mmddyyyy(now),
        limit: s.criteria.limit ?? 25,
        offset: 0,
      };

      const resp = await searchDibbsOpportunities(cfg, criteria);
      let importedCount = 0;

      if (!dryRun && s.autoImport && projectId) {
        for (const opp of resp.opportunities.slice(0, 25)) {
          if (!opp.solicitationNumber) continue;
          try {
            const oppRaw = await fetchDibbsSolicitation(cfg, opp.solicitationNumber);
            const attachments = extractDibbsAttachments(oppRaw);
            const { oppId } = await createOpportunity({ orgId, projectId, opportunity: {
              orgId, projectId, source: 'DIBBS', id: opp.solicitationNumber,
              title: opp.title ?? 'Untitled', type: opp.type ?? null,
              postedDateIso: opp.postedDate ? new Date(opp.postedDate).toISOString() : null,
              responseDeadlineIso: opp.closingDate ? new Date(opp.closingDate).toISOString() : null,
              noticeId: null, solicitationNumber: opp.solicitationNumber,
              naicsCode: opp.naicsCode ?? null, pscCode: opp.pscCode ?? null,
              organizationName: opp.dodComponent ?? null, organizationCode: null,
              setAside: opp.setAside ?? null, setAsideCode: opp.setAsideCode ?? null,
              description: opp.description ?? null, active: true,
              baseAndAllOptionsValue: opp.baseAndAllOptionsValue ?? null,
            }});
            for (const a of attachments) {
              const filename = buildAttachmentFilename(a);
              const { buf, contentType } = await httpsGetBuffer(new URL(a.url), { httpsAgent });
              const ct = a.mimeType || contentType || guessContentType(filename);
              const fileKey = buildAttachmentS3Key({ orgId, projectId, noticeId: opp.solicitationNumber, attachmentUrl: a.url, filename });
              await uploadToS3(DOCUMENTS_BUCKET, fileKey, buf, ct ?? 'application/octet-stream');
              const qf = await createQuestionFile(orgId, { oppId, projectId, fileKey, originalFileName: filename, mimeType: ct ?? null });
              await startPipeline(projectId, oppId, qf.questionFileId, qf.fileKey, qf.mimeType);
              importedCount++;
            }
          } catch (err) { console.error('DIBBS auto-import error:', err); }
        }
      }

      if (!dryRun) await updateDibbsSavedSearchLastRunAt(orgId, s.savedSearchId, ranAtIso);
      results.push({ savedSearchId: s.savedSearchId, name: s.name, found: resp.opportunities.length, importedCount });
    }

    if (results.length) resultsByOrg.push({ orgId, results });
  }

  return { ok: true, dryRun, ranAt: ranAtIso, orgCount: orgIds.length, resultsByOrg };
};

export const handler = withSentryLambda(middy(baseHandler));
```

## 6. REST API Routes <!-- ✅ IMPLEMENTED -->

### 6.1 Route File

**File:** `packages/infra/api/routes/dibbs.routes.ts`

```typescript
import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const dibbsDomain = (): DomainRoutes => ({
  basePath: 'dibbs',
  routes: [
    // API Key Management
    { method: 'POST',   path: 'set-api-key',              entry: lambdaEntry('dibbs/set-api-key.ts') },
    { method: 'GET',    path: 'get-api-key',              entry: lambdaEntry('dibbs/get-api-key.ts') },
    // Search & Import
    { method: 'POST',   path: 'search-opportunities',     entry: lambdaEntry('dibbs/search-opportunities.ts') },
    { method: 'POST',   path: 'import-solicitation',      entry: lambdaEntry('dibbs/import-solicitation.ts'), timeoutSeconds: 60 },
    // Saved Searches
    { method: 'POST',   path: 'create-saved-search',      entry: lambdaEntry('dibbs/create-saved-search.ts') },
    { method: 'GET',    path: 'list-saved-search',        entry: lambdaEntry('dibbs/list-saved-search.ts') },
    { method: 'PATCH',  path: 'edit-saved-search/{id}',   entry: lambdaEntry('dibbs/edit-saved-search.ts') },
    { method: 'DELETE', path: 'delete-saved-search/{id}', entry: lambdaEntry('dibbs/delete-saved-search.ts') },
  ],
});
```

### 6.2 Register in Orchestrator

**File:** `packages/infra/api/api-orchestrator-stack.ts` — add the following:

```typescript
// 1. Import at top of file
import { dibbsDomain } from './routes/dibbs.routes';

// 2. Add to allDomains array (after samgovDomain())
dibbsDomain(),

// 3. Add to domainStackNames array (after 'SamgovRoutes')
'DibbsRoutes',

// 4. Add DIBBS_BASE_URL to commonEnv
DIBBS_BASE_URL: 'https://www.dibbs.bsm.dla.mil',
```

### 6.3 Endpoint Summary

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/dibbs/set-api-key` | `org:manage_settings` | Store DIBBS API key in Secrets Manager |
| `GET` | `/dibbs/get-api-key` | `org:manage_settings` | Retrieve masked DIBBS API key |
| `POST` | `/dibbs/search-opportunities` | `opportunity:read` | Search DIBBS solicitations |
| `POST` | `/dibbs/import-solicitation` | `opportunity:create` + `question:create` | Import solicitation + attachments into pipeline |
| `POST` | `/dibbs/create-saved-search` | `opportunity:create` | Create a saved search |
| `GET` | `/dibbs/list-saved-search` | `opportunity:read` | List saved searches for org |
| `PATCH` | `/dibbs/edit-saved-search/{id}` | `opportunity:edit` | Update saved search |
| `DELETE` | `/dibbs/delete-saved-search/{id}` | `opportunity:delete` | Delete saved search |

## 7. CDK Stack Updates <!-- ✅ IMPLEMENTED -->

### 7.1 EventBridge Scheduler for `run-saved-search`

Add to `packages/infra/api/api-orchestrator-stack.ts` (or a dedicated `dibbs-scheduler-stack.ts`):

```typescript
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';

// ─── DIBBS run-saved-search Lambda ───────────────────────────────────────────
const dibbsRunSavedSearchFn = new lambdaNodejs.NodejsFunction(this, `DibbsRunSavedSearch-${stage}`, {
  functionName: `auto-rfp-dibbs-run-saved-search-${stage}`,
  entry: path.join(__dirname, '../../../apps/functions/src/handlers/dibbs/run-saved-search.ts'),
  handler: 'handler',
  runtime: lambda.Runtime.NODEJS_20_X,
  timeout: cdk.Duration.minutes(5),
  memorySize: 256,
  role: sharedInfraStack.commonLambdaRole,
  environment: {
    ...commonEnv,
    DIBBS_BASE_URL: 'https://www.dibbs.bsm.dla.mil',
  },
  bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
});

// CloudWatch Log Group (2 weeks non-prod, INFINITE prod)
new logs.LogGroup(this, `DibbsRunSavedSearchLogs-${stage}`, {
  logGroupName: `/aws/lambda/auto-rfp-dibbs-run-saved-search-${stage}`,
  retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// EventBridge rule — run every hour
new events.Rule(this, `DibbsRunSavedSearchRule-${stage}`, {
  ruleName: `auto-rfp-dibbs-run-saved-search-${stage}`,
  schedule: events.Schedule.rate(cdk.Duration.hours(1)),
  targets: [
    new targets.LambdaFunction(dibbsRunSavedSearchFn, {
      event: events.RuleTargetInput.fromObject({ dryRun: false }),
    }),
  ],
});
```

### 7.2 IAM Additions

The existing `commonLambdaRole` already has `secretsmanager:*` on `*-api-key-*` secrets — this covers `dibbs-api-key-{orgId}` automatically. No additional IAM changes needed.

### 7.3 Environment Variable

Add `DIBBS_BASE_URL` to `commonEnv` in `api-orchestrator-stack.ts`:

```typescript
DIBBS_BASE_URL: 'https://www.dibbs.bsm.dla.mil',
```

### 7.4 Infrastructure Summary

| Resource | Type | Notes |
|---|---|---|
| `auto-rfp-dibbs-run-saved-search-{stage}` | Lambda | EventBridge-triggered scheduler |
| `/aws/lambda/auto-rfp-dibbs-run-saved-search-{stage}` | CloudWatch Log Group | 2 weeks non-prod, INFINITE prod |
| `auto-rfp-dibbs-run-saved-search-{stage}` | EventBridge Rule | Hourly schedule |
| `dibbs-api-key-{orgId}` | Secrets Manager secret | Created on first `set-api-key` call |
| 8 REST Lambda functions | Lambda (via `ApiDomainRoutesStack`) | Registered via `dibbsDomain()` |
## 8. Frontend — Hooks & Components <!-- ✅ IMPLEMENTED -->

### 8.1 File Structure

```
apps/web/features/dibbs/
├── hooks/
│   ├── useDibbsSearch.ts          # POST search (SWR mutation)
│   ├── useDibbsSavedSearches.ts   # GET list (SWR)
│   ├── useDibbsImport.ts          # POST import (apiMutate)
│   ├── useCreateDibbsSavedSearch.ts
│   ├── useEditDibbsSavedSearch.ts
│   └── useDeleteDibbsSavedSearch.ts
├── components/
│   ├── DibbsApiKeyManager.tsx     # API key setup card
│   ├── DibbsSearchForm.tsx        # Search filters form
│   ├── DibbsResultsTable.tsx      # Search results table
│   └── DibbsSavedSearchList.tsx   # Saved searches management
└── index.ts                       # Barrel export
```

### 8.2 `hooks/useDibbsSearch.ts`

```typescript
'use client';

import { useState } from 'react';
import type { SearchDibbsOpportunitiesRequest, SearchDibbsOpportunitiesResponse } from '@auto-rfp/core';
import { apiMutate } from '@/lib/helpers/api-mutate';

export const useDibbsSearch = (orgId: string | undefined) => {
  const [data, setData]       = useState<SearchDibbsOpportunitiesResponse | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError]     = useState<Error | null>(null);

  const search = async (criteria: SearchDibbsOpportunitiesRequest) => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiMutate<SearchDibbsOpportunitiesResponse>(
        '/dibbs/search-opportunities',
        { method: 'POST', body: criteria, headers: { 'x-org-id': orgId } },
      );
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Search failed'));
    } finally {
      setLoading(false);
    }
  };

  return { data, isLoading, error, search };
};
```

### 8.3 `hooks/useDibbsSavedSearches.ts`

```typescript
'use client';

import useSWR from 'swr';
import type { DibbsSavedSearch } from '@auto-rfp/core';
import { authenticatedFetcher } from '@/lib/helpers/authenticated-fetcher';

interface DibbsSavedSearchesResponse {
  items: DibbsSavedSearch[];
  count: number;
}

export const useDibbsSavedSearches = (orgId: string | undefined) => {
  const { data, error, isLoading, mutate } = useSWR<DibbsSavedSearchesResponse>(
    orgId ? `/dibbs/list-saved-search?orgId=${orgId}` : null,
    authenticatedFetcher,
  );

  return {
    savedSearches: data?.items ?? [],
    count: data?.count ?? 0,
    isLoading,
    isError: Boolean(error),
    error,
    mutate,
  };
};
```

### 8.4 `hooks/useDibbsImport.ts`

```typescript
'use client';

import { useState } from 'react';
import type { ImportDibbsSolicitationRequest } from '@auto-rfp/core';
import { apiMutate } from '@/lib/helpers/api-mutate';

export const useDibbsImport = () => {
  const [isLoading, setLoading] = useState(false);
  const [error, setError]       = useState<Error | null>(null);

  const importSolicitation = async (req: ImportDibbsSolicitationRequest) => {
    setLoading(true);
    setError(null);
    try {
      return await apiMutate('/dibbs/import-solicitation', { method: 'POST', body: req });
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Import failed');
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  return { importSolicitation, isLoading, error };
};
```

### 8.5 `components/DibbsSearchForm.tsx`

```typescript
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SearchDibbsOpportunitiesRequestSchema, type SearchDibbsOpportunitiesRequest } from '@auto-rfp/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface DibbsSearchFormProps {
  onSearch: (criteria: SearchDibbsOpportunitiesRequest) => void;
  isLoading: boolean;
}

export const DibbsSearchForm = ({ onSearch, isLoading }: DibbsSearchFormProps) => {
  const { register, handleSubmit } = useForm<SearchDibbsOpportunitiesRequest>({
    resolver: zodResolver(SearchDibbsOpportunitiesRequestSchema),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search DIBBS Opportunities</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSearch)} className="space-y-4">
          <Input {...register('keywords')} placeholder="Keywords (e.g. AI, cybersecurity)" />
          <Input {...register('solicitationNumber')} placeholder="Solicitation Number" />
          <div className="grid grid-cols-2 gap-4">
            <Input {...register('postedFrom')} placeholder="Posted From (MM/dd/yyyy)" />
            <Input {...register('postedTo')}   placeholder="Posted To (MM/dd/yyyy)" />
          </div>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Searching…' : 'Search'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
```

### 8.6 `components/DibbsResultsTable.tsx`

```typescript
'use client';

import type { DibbsOpportunitySlim } from '@auto-rfp/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface DibbsResultsTableProps {
  opportunities: DibbsOpportunitySlim[];
  isLoading: boolean;
  onImport: (solicitationNumber: string) => void;
  importingId: string | null;
}

export const DibbsResultsTable = ({
  opportunities,
  isLoading,
  onImport,
  importingId,
}: DibbsResultsTableProps) => {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!opportunities.length) {
    return <p className="text-sm text-muted-foreground">No results found.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4">Solicitation #</th>
            <th className="py-2 pr-4">Title</th>
            <th className="py-2 pr-4">DoD Component</th>
            <th className="py-2 pr-4">Closing Date</th>
            <th className="py-2 pr-4">Vehicle</th>
            <th className="py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opp) => (
            <tr key={opp.solicitationNumber} className="border-b hover:bg-muted/50">
              <td className="py-2 pr-4 font-mono text-xs">{opp.solicitationNumber ?? '—'}</td>
              <td className="py-2 pr-4 max-w-xs truncate">{opp.title ?? '—'}</td>
              <td className="py-2 pr-4">
                {opp.dodComponent ? <Badge variant="outline">{opp.dodComponent}</Badge> : '—'}
              </td>
              <td className="py-2 pr-4">{opp.closingDate ?? '—'}</td>
              <td className="py-2 pr-4">{opp.contractVehicle ?? '—'}</td>
              <td className="py-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!opp.solicitationNumber || importingId === opp.solicitationNumber}
                  onClick={() => opp.solicitationNumber && onImport(opp.solicitationNumber)}
                >
                  {importingId === opp.solicitationNumber ? 'Importing…' : 'Import'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
```

### 8.7 `index.ts` (barrel export)

```typescript
export * from './hooks/useDibbsSearch';
export * from './hooks/useDibbsSavedSearches';
export * from './hooks/useDibbsImport';
export * from './hooks/useCreateDibbsSavedSearch';
export * from './hooks/useEditDibbsSavedSearch';
export * from './hooks/useDeleteDibbsSavedSearch';
export * from './components/DibbsApiKeyManager';
export * from './components/DibbsSearchForm';
export * from './components/DibbsResultsTable';
export * from './components/DibbsSavedSearchList';
```
## 9. Permissions & RBAC <!-- ✅ IMPLEMENTED -->

No new permissions are required. DIBBS reuses the existing `opportunity:*` and `org:manage_settings` permissions already defined in `packages/core/src/schemas/user.ts`.

### Permission Matrix

| Endpoint | ADMIN | EDITOR | VIEWER | BILLING |
|---|---|---|---|---|
| `POST /dibbs/set-api-key` | ✅ | ❌ | ❌ | ❌ |
| `GET /dibbs/get-api-key` | ✅ | ❌ | ❌ | ❌ |
| `POST /dibbs/search-opportunities` | ✅ | ✅ | ✅ | ❌ |
| `POST /dibbs/import-solicitation` | ✅ | ✅ | ❌ | ❌ |
| `POST /dibbs/create-saved-search` | ✅ | ✅ | ❌ | ❌ |
| `GET /dibbs/list-saved-search` | ✅ | ✅ | ✅ | ❌ |
| `PATCH /dibbs/edit-saved-search/{id}` | ✅ | ✅ | ❌ | ❌ |
| `DELETE /dibbs/delete-saved-search/{id}` | ✅ | ❌ | ❌ | ❌ |

## 10. Implementation Tickets <!-- ✅ IMPLEMENTED -->

### DB-1 · Core Schemas (45 min) <!-- ✅ IMPLEMENTED -->

**Files to create/modify:**
- `packages/core/src/schemas/dibbs.ts` ← create
- `packages/core/src/schemas/index.ts` ← add `export * from './dibbs'`
- `packages/core/src/schemas/opportunity.ts` ← add `'DIBBS'` to `OpportunitySourceSchema`

**Acceptance criteria:**
- [ ] `DibbsSavedSearchSchema`, `SearchDibbsOpportunitiesRequestSchema`, `DibbsOpportunitySlimSchema`, `ImportDibbsSolicitationRequestSchema` all compile
- [ ] `OpportunitySourceSchema` includes `'DIBBS'`
- [ ] All types inferred from Zod — no manual type definitions

---

### DB-2 · Constants & Helpers (45 min) <!-- ✅ IMPLEMENTED -->

**Files to create:**
- `apps/functions/src/constants/dibbs.ts`
- `apps/functions/src/helpers/dibbs.ts`

**Acceptance criteria:**
- [ ] `DIBBS_SAVED_SEARCH_PK` and `DIBBS_SECRET_PREFIX` exported from constants
- [ ] `searchDibbsOpportunities`, `fetchDibbsSolicitation`, `extractDibbsAttachments` implemented
- [ ] All DynamoDB helpers (`createDibbsSavedSearch`, `listDibbsSavedSearches`, `getDibbsSavedSearch`, `deleteDibbsSavedSearch`, `updateDibbsSavedSearchLastRunAt`) implemented
- [ ] TypeScript compiles with no errors

---

### DB-3 · Lambda Handlers (3 hours) <!-- ✅ IMPLEMENTED -->

**Files to create:**
- `apps/functions/src/handlers/dibbs/search-opportunities.ts`
- `apps/functions/src/handlers/dibbs/import-solicitation.ts`
- `apps/functions/src/handlers/dibbs/set-api-key.ts`
- `apps/functions/src/handlers/dibbs/get-api-key.ts`
- `apps/functions/src/handlers/dibbs/create-saved-search.ts`
- `apps/functions/src/handlers/dibbs/list-saved-search.ts`
- `apps/functions/src/handlers/dibbs/edit-saved-search.ts`
- `apps/functions/src/handlers/dibbs/delete-saved-search.ts`
- `apps/functions/src/handlers/dibbs/run-saved-search.ts`

**Acceptance criteria:**
- [ ] All handlers use `apiResponse` — no raw response objects
- [ ] All `safeParse` results destructured immediately
- [ ] `orgId` sourced from body/query/path — never from token
- [ ] All handlers wrapped with correct Middy middleware stack
- [ ] TypeScript compiles with no errors

---

### DB-4 · CDK Infrastructure (1 hour) <!-- ✅ IMPLEMENTED -->

**Files to create/modify:**
- `packages/infra/api/routes/dibbs.routes.ts` ← create
- `packages/infra/api/api-orchestrator-stack.ts` ← add `dibbsDomain()`, `'DibbsRoutes'`, `DIBBS_BASE_URL`, EventBridge rule + Lambda + Log Group

**Acceptance criteria:**
- [ ] `dibbsDomain()` registered in `allDomains` and `domainStackNames`
- [ ] `DIBBS_BASE_URL` in `commonEnv`
- [ ] `auto-rfp-dibbs-run-saved-search-{stage}` Lambda defined with CloudWatch Log Group
- [ ] EventBridge rule triggers Lambda hourly
- [ ] `cdk synth` succeeds without errors

---

### DB-5 · Frontend Feature (2 hours) <!-- ✅ IMPLEMENTED -->

**Files to create:**
- `apps/web/features/dibbs/hooks/useDibbsSearch.ts`
- `apps/web/features/dibbs/hooks/useDibbsSavedSearches.ts`
- `apps/web/features/dibbs/hooks/useDibbsImport.ts`
- `apps/web/features/dibbs/hooks/useCreateDibbsSavedSearch.ts`
- `apps/web/features/dibbs/hooks/useEditDibbsSavedSearch.ts`
- `apps/web/features/dibbs/hooks/useDeleteDibbsSavedSearch.ts`
- `apps/web/features/dibbs/components/DibbsApiKeyManager.tsx`
- `apps/web/features/dibbs/components/DibbsSearchForm.tsx`
- `apps/web/features/dibbs/components/DibbsResultsTable.tsx`
- `apps/web/features/dibbs/components/DibbsSavedSearchList.tsx`
- `apps/web/features/dibbs/index.ts`

**Acceptance criteria:**
- [ ] All components use `'use client'` directive
- [ ] Loading states use `Skeleton` components — no spinners or "Loading..." text
- [ ] Types imported from `@auto-rfp/core` — no inline interfaces
- [ ] Barrel exports from `index.ts` — pages import from `@/features/dibbs`
- [ ] TypeScript compiles with no errors

---

### DB-6 · Integration Testing (1.5 hours) <!-- ✅ IMPLEMENTED -->

**Acceptance criteria:**
- [ ] `POST /dibbs/set-api-key` stores key in Secrets Manager
- [ ] `POST /dibbs/search-opportunities` returns results from live DIBBS API
- [ ] `POST /dibbs/import-solicitation` creates `OpportunityItem` with `source: 'DIBBS'` and triggers question pipeline
- [ ] Saved search CRUD works end-to-end
- [ ] `run-saved-search` Lambda processes enabled searches and auto-imports when configured
- [ ] DIBBS opportunities appear in unified opportunity dashboard alongside SAM.gov results

## 11. Acceptance Criteria Checklist <!-- ✅ IMPLEMENTED -->

- [ ] DIBBS API key can be stored and retrieved per organization
- [ ] Search returns results filtered by technology area, DoD component, contract vehicle, dollar range, innovation topic
- [ ] Import creates `OpportunityItem` with `source: 'DIBBS'` and triggers the question-file pipeline
- [ ] Saved searches persist in DynamoDB and are listed per org
- [ ] Saved search scheduler runs hourly via EventBridge
- [ ] Auto-import imports up to 25 opportunities per saved search run
- [ ] DIBBS opportunities appear in the unified opportunity dashboard (same view as SAM.gov)
- [ ] All Lambda handlers have CloudWatch Log Groups with correct retention
- [ ] TypeScript compiles across all packages with no errors
- [ ] No `any` types used — all types inferred from Zod schemas

## 12. Summary of New Files <!-- ✅ IMPLEMENTED -->

| File | Purpose | Status |
|---|---|---|
| `packages/core/src/schemas/dibbs.ts` | All DIBBS Zod schemas and inferred types | ⏳ |
| `packages/core/src/schemas/opportunity.ts` | Add `'DIBBS'` to `OpportunitySourceSchema` | ⏳ |
| `packages/core/src/schemas/index.ts` | Re-export `dibbs` schemas | ⏳ |
| `apps/functions/src/constants/dibbs.ts` | `DIBBS_SAVED_SEARCH_PK`, `DIBBS_SECRET_PREFIX` | ⏳ |
| `apps/functions/src/helpers/dibbs.ts` | DIBBS API client + SK builders + DynamoDB helpers | ⏳ |
| `apps/functions/src/handlers/dibbs/search-opportunities.ts` | `POST /dibbs/search-opportunities` | ⏳ |
| `apps/functions/src/handlers/dibbs/import-solicitation.ts` | `POST /dibbs/import-solicitation` | ⏳ |
| `apps/functions/src/handlers/dibbs/set-api-key.ts` | `POST /dibbs/set-api-key` | ⏳ |
| `apps/functions/src/handlers/dibbs/get-api-key.ts` | `GET /dibbs/get-api-key` | ⏳ |
| `apps/functions/src/handlers/dibbs/create-saved-search.ts` | `POST /dibbs/create-saved-search` | ⏳ |
| `apps/functions/src/handlers/dibbs/list-saved-search.ts` | `GET /dibbs/list-saved-search` | ⏳ |
| `apps/functions/src/handlers/dibbs/edit-saved-search.ts` | `PATCH /dibbs/edit-saved-search/{id}` | ⏳ |
| `apps/functions/src/handlers/dibbs/delete-saved-search.ts` | `DELETE /dibbs/delete-saved-search/{id}` | ⏳ |
| `apps/functions/src/handlers/dibbs/run-saved-search.ts` | EventBridge scheduler — runs saved searches hourly | ⏳ |
| `packages/infra/api/routes/dibbs.routes.ts` | CDK route definitions for DIBBS domain | ⏳ |
| `apps/web/features/dibbs/hooks/useDibbsSearch.ts` | POST search hook | ⏳ |
| `apps/web/features/dibbs/hooks/useDibbsSavedSearches.ts` | GET saved searches SWR hook | ⏳ |
| `apps/web/features/dibbs/hooks/useDibbsImport.ts` | POST import hook | ⏳ |
| `apps/web/features/dibbs/hooks/useCreateDibbsSavedSearch.ts` | Create saved search mutation hook | ⏳ |
| `apps/web/features/dibbs/hooks/useEditDibbsSavedSearch.ts` | Edit saved search mutation hook | ⏳ |
| `apps/web/features/dibbs/hooks/useDeleteDibbsSavedSearch.ts` | Delete saved search mutation hook | ⏳ |
| `apps/web/features/dibbs/components/DibbsApiKeyManager.tsx` | API key setup card component | ⏳ |
| `apps/web/features/dibbs/components/DibbsSearchForm.tsx` | Search filters form component | ⏳ |
| `apps/web/features/dibbs/components/DibbsResultsTable.tsx` | Search results table with Import button | ⏳ |
| `apps/web/features/dibbs/components/DibbsSavedSearchList.tsx` | Saved searches management component | ⏳ |
| `apps/web/features/dibbs/index.ts` | Barrel export for the dibbs feature | ⏳ |

### Modified Files

| File | Change |
|---|---|
| `packages/core/src/schemas/index.ts` | Add `export * from './dibbs'` |
| `packages/core/src/schemas/opportunity.ts` | Add `'DIBBS'` to `OpportunitySourceSchema` enum |
| `packages/infra/api/api-orchestrator-stack.ts` | Import `dibbsDomain`, add to `allDomains`/`domainStackNames`, add `DIBBS_BASE_URL` env var, add EventBridge rule + Lambda + Log Group |

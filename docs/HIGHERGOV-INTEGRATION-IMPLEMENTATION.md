# HigherGov Integration — Implementation Document <!-- ⏳ PENDING -->

## 1. Overview <!-- ⏳ PENDING -->

| Field | Value |
|---|---|
| **Feature** | HigherGov as a search source |
| **Goal** | Search HigherGov from our UI, import opportunities, save recurring searches in our system with auto-import |
| **Affected packages** | `packages/core`, `apps/functions`, `apps/web` |
| **External dependency** | HigherGov REST API v1.2 (`https://www.highergov.com/api-external/`) |
| **Auth** | API key (query parameter `?api_key=KEY`) — stored in Secrets Manager |

### What the client asked for

> "I had a bunch of higher gov opportunities that I found and put under my favorites, is there a way for us to pull the saved searches and/or use the higher gov API to search for those same opportunities? That would save me a ton of time instead of manually importing these opportunities."

### Capabilities delivered

1. **Search HigherGov from our UI** — new source option in the unified search page, with HigherGov-specific filter (`source_type`: sbir, grant, sled, etc.)
2. **Import from search results** — click to import any HigherGov result, same as SAM.gov/DIBBS
3. **Save as AutoRFP saved search** — save HigherGov search criteria in our system with frequency + auto-import (existing saved search infrastructure, `source: 'HIGHER_GOV'`)
4. **Cross-source dedup** — if an opportunity was already imported from SAM.gov, importing the same one from HigherGov is detected and skipped

### What this does NOT do

- Does NOT pull HigherGov's own saved searches or `search_id` system
- Does NOT bulk-import HigherGov pursuits/favorites
- Does NOT push data to HigherGov (the API is read-only)
- Does NOT add new API routes or handlers — HigherGov plugs into existing multi-source infrastructure

---

## 2. Architecture Overview <!-- ⏳ PENDING -->

```
┌──────────────────────────────────────────────────────────────────┐
│                      Frontend (apps/web)                          │
│  ┌──────────────────┐  ┌─────────────────────────────────────┐   │
│  │ Search Form      │  │ Save Search (ours)                  │   │
│  │ source=HIGHER_GOV│  │ source=HIGHER_GOV, freq=DAILY       │   │
│  └────────┬─────────┘  └──────────────────┬──────────────────┘   │
└───────────┼────────────────────────────────┼─────────────────────┘
            │                                │
            ▼                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                   API Gateway (existing routes)                   │
│  POST /search-opportunities/search        { source: 'HIGHER_GOV'}│
│  POST /search-opportunities/import-solicitation                   │
│  POST /search-opportunities/saved-search  { source: 'HIGHER_GOV'}│
│  (EventBridge) run-saved-search.ts                                │
└──────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│            HigherGov Helper (new file in helpers/)                │
│  searchHigherGovOpportunities()   fetchHigherGovOpportunity()    │
│  fetchHigherGovDocuments()        higherGovToSearchOpportunity()  │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
              ┌────────────────────┐
              │  HigherGov API     │
              │  /opportunity/     │
              │  /document/        │
              └────────────────────┘
```

**Key insight:** Zero new routes. Zero new handlers. HigherGov is added as a third source inside the existing `search.ts`, `import-solicitation.ts`, and `run-saved-search.ts` handlers, exactly like DIBBS was added alongside SAM.gov.

| Decision | Choice | Rationale |
|---|---|---|
| API key storage | Secrets Manager (prefix `highergov`) | Matches SAM.gov/DIBBS pattern |
| Source enum | `HIGHER_GOV` added to `OpportunitySourceSchema` | Unified search, import, filtering |
| Saved searches | Existing `saved-search-create.ts` with `source: 'HIGHER_GOV'` | Zero new code |
| New routes | None | Everything plugs into existing endpoints |
| Document downloads | Immediate during import | HigherGov download URLs expire in 60 minutes |

### HigherGov API reference

| Endpoint | Use | Update frequency |
|---|---|---|
| `GET /api-external/opportunity/` | Search by keyword, agency, source_type, posted_date | Every 20-30 min |
| `GET /api-external/document/` | Get attachment download URLs (expire in 60 min) | Real-time |
| **Quota** | 10K records/month, 10 req/s, 100K req/day | |
| **Pagination** | `page_number` + `page_size` (max 100) | |

> **Important**: HigherGov schemas below are based on API documentation, not verified against actual responses. All Zod schemas use `.passthrough()` during initial development. Remove once validated against real data.

---

## 3. Data Models & Zod Schemas <!-- ⏳ PENDING -->

### 3.1 Update `packages/core/src/schemas/opportunity.ts`

Add `HIGHER_GOV` to the source enum:

```typescript
export const OpportunitySourceSchema = z.enum(['SAM_GOV', 'DIBBS', 'HIGHER_GOV', 'MANUAL_UPLOAD']);
```

Add optional HigherGov-specific fields to `OpportunityItemSchema`:

```typescript
  // ... existing fields ...

  /** HigherGov unique opportunity key (used for dedup and re-fetch) */
  higherGovOppKey: z.string().nullish(),
  /** HigherGov AI-generated summary — proprietary enrichment */
  higherGovAiSummary: z.string().nullish(),
```

### 3.2 Update `packages/core/src/schemas/search-opportunity.ts`

Add `HIGHER_GOV` to saved search source:

```typescript
export const SavedSearchSourceSchema = z.enum(['SAM_GOV', 'DIBBS', 'HIGHER_GOV']);
```

Add HigherGov-specific filter to `LoadSearchOpportunitiesRequestSchema`:

```typescript
  // ── HigherGov-specific ───────────────────────────────────────────────
  /** HigherGov source_type filter: 'sam', 'dibbs', 'sbir', 'grant', 'sled'.
   *  Useful to avoid duplicating results from sources the user already searches directly. */
  higherGovSourceType: z.enum(['sam', 'dibbs', 'sbir', 'grant', 'sled']).optional(),
```

Add HigherGov slim result schema:

```typescript
// ═══════════════════════════════════════════════════════════════════════════════
// HIGHER_GOV
// ═══════════════════════════════════════════════════════════════════════════════

export const HigherGovOpportunitySlimSchema = z.object({
  opp_key:              z.string(),
  title:                z.string().optional(),
  description_text:     z.string().optional(),
  ai_summary:           z.string().optional(),
  source_id:            z.string().optional(),
  source_type:          z.string().optional(),
  captured_date:        z.string().optional(),
  posted_date:          z.string().optional(),
  due_date:             z.string().optional(),
  agency: z.object({
    name:         z.string().optional(),
    abbreviation: z.string().optional(),
    type:         z.string().optional(),
  }).passthrough().optional(),
  naics_code: z.object({
    code:        z.string().optional(),
    description: z.string().optional(),
  }).passthrough().optional(),
  psc_code: z.object({
    code:        z.string().optional(),
    description: z.string().optional(),
  }).passthrough().optional(),
  opp_type: z.object({
    name: z.string().optional(),
  }).passthrough().optional(),
  set_aside:        z.string().optional(),
  val_est_low:      z.string().optional(),
  val_est_high:     z.string().optional(),
  pop_state:        z.string().optional(),
  sole_source_flag: z.boolean().optional(),
  path:             z.string().optional(),
  source_path:      z.string().optional(),
  document_path:    z.string().optional(),
}).passthrough();

export type HigherGovOpportunitySlim = z.infer<typeof HigherGovOpportunitySlimSchema>;
```

Add mapper (after existing mappers):

```typescript
export const higherGovToSearchOpportunity = (o: HigherGovOpportunitySlim): SearchOpportunitySlim => ({
  id:                     o.opp_key,
  source:                 'HIGHER_GOV',
  solicitationNumber:     null,
  noticeId:               o.source_id ?? null,   // SAM.gov noticeId when source_type=sam
  title:                  o.title ?? '',
  type:                   o.opp_type?.name ?? null,
  postedDate:             o.posted_date ?? null,
  closingDate:            o.due_date ?? null,
  naicsCode:              o.naics_code?.code ?? null,
  organizationName:       o.agency?.name ?? null,
  contractVehicle:        null,
  setAside:               o.set_aside ?? null,
  technologyArea:         null,
  description:            o.ai_summary ?? o.description_text ?? null,
  descriptionUrl:         null,
  active:                 true,
  baseAndAllOptionsValue: o.val_est_high ? parseFloat(o.val_est_high) || null : null,
  attachmentsCount:       0,   // resolved at import time via Document endpoint
  url:                    o.path ? `https://www.highergov.com${o.path}` : null,
});
```

Add import request variant (for `import-solicitation.ts` discriminated union):

```typescript
export const ImportHigherGovRequestSchema = z.object({
  source:           z.literal('HIGHER_GOV'),
  orgId:            z.string().min(1),
  projectId:        z.string().min(1),
  oppKey:           z.string().min(1),
  sourceDocumentId: z.string().optional(),
  force:            z.boolean().optional(),
});

export type ImportHigherGovRequest = z.infer<typeof ImportHigherGovRequestSchema>;
```

---

## 4. DynamoDB Design <!-- ⏳ PENDING -->

### 4.1 Constants

**New file:** `apps/functions/src/constants/highergov.ts`

```typescript
export const HIGHERGOV_SECRET_PREFIX = 'highergov';
export const HIGHERGOV_BASE_URL = 'https://www.highergov.com/api-external';
```

### 4.2 Access patterns

No new DynamoDB entities. HigherGov opportunities are stored as `OpportunityItem` with `source: 'HIGHER_GOV'`. Saved searches use the existing unified `SAVED_SEARCH` PK.

### 4.3 Update `findOpportunityBySourceId`

**File:** `apps/functions/src/helpers/opportunity.ts`

Add `higherGovOppKey` with cross-source dedup:

```typescript
export const findOpportunityBySourceId = async (args: {
  orgId: string;
  noticeId?: string;
  solicitationNumber?: string;
  higherGovOppKey?: string;   // ← NEW
}): Promise<OpportunityItem | null> => {
  // existing logic for noticeId / solicitationNumber ...

  if (args.higherGovOppKey) {
    const items = await queryBySkPrefix(OPPORTUNITY_PK, args.orgId, {
      FilterExpression: 'higherGovOppKey = :hgk OR noticeId = :nid',
      ExpressionAttributeValues: {
        ':hgk': args.higherGovOppKey,
        ':nid': args.higherGovOppKey,  // opp_key might match a SAM.gov noticeId
      },
    });
    return items[0] ?? null;
  }

  return null;
};
```

**Why cross-source dedup:** HigherGov aggregates from SAM.gov. Its `source_id` is the SAM.gov `noticeId`. If an opportunity was already imported from SAM.gov, we must detect it when the user tries to import the same one from HigherGov search results.

---

## 5. Backend — Handler Updates <!-- ⏳ PENDING -->

### 5.1 HigherGov Helper

**New file:** `apps/functions/src/helpers/highergov.ts`

```typescript
/**
 * HigherGov API client.
 *
 * REST API v1.2 — https://www.highergov.com/api-external/docs/
 * Auth: api_key query parameter
 * Rate limit: 10 req/s, 100K req/day, 10K records/month
 */
import https from 'https';
import type { HigherGovOpportunitySlim } from '@auto-rfp/core';

export type HigherGovConfig = {
  baseUrl: string;
  apiKey: string;
  httpsAgent?: https.Agent;
};

export type HigherGovAttachment = {
  url: string;
  name?: string;
  mimeType?: string;
};

// ─── HTTP helper ─────────────────────────────────────────────────────────────

const httpsGetJson = async (url: URL, agent?: https.Agent): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HigherGov API ${res.statusCode}: ${body.substring(0, 300)}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON from HigherGov')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
};

// ─── Search opportunities ────────────────────────────────────────────────────

export const searchHigherGovOpportunities = async (
  cfg: HigherGovConfig,
  params: {
    keywords?: string;
    agencyKey?: string;
    sourceType?: string;       // 'sam' | 'dibbs' | 'sbir' | 'grant' | 'sled'
    postedDate?: string;       // YYYY-MM-DD
    ordering?: string;
    pageNumber?: number;
    pageSize?: number;
  },
): Promise<{ results: HigherGovOpportunitySlim[]; totalCount: number; pages: number }> => {
  const url = new URL('/api-external/opportunity/', cfg.baseUrl);
  url.searchParams.set('api_key', cfg.apiKey);

  if (params.keywords)   url.searchParams.set('keywords', params.keywords);
  if (params.agencyKey)  url.searchParams.set('agency_key', params.agencyKey);
  if (params.sourceType) url.searchParams.set('source_type', params.sourceType);
  if (params.postedDate) url.searchParams.set('posted_date', params.postedDate);
  url.searchParams.set('ordering', params.ordering ?? '-captured_date');
  url.searchParams.set('page_number', String(params.pageNumber ?? 1));
  url.searchParams.set('page_size', String(Math.min(params.pageSize ?? 25, 100)));

  const json = await httpsGetJson(url, cfg.httpsAgent) as Record<string, unknown>;
  const results = (Array.isArray(json.results) ? json.results : []) as HigherGovOpportunitySlim[];
  const meta = json.meta as Record<string, unknown> | undefined;
  const pagination = meta?.pagination as Record<string, number> | undefined;

  return {
    results,
    totalCount: pagination?.count ?? results.length,
    pages:      pagination?.pages ?? 1,
  };
};

// ─── Fetch single opportunity ────────────────────────────────────────────────

export const fetchHigherGovOpportunity = async (
  cfg: HigherGovConfig,
  oppKey: string,
): Promise<HigherGovOpportunitySlim> => {
  const url = new URL('/api-external/opportunity/', cfg.baseUrl);
  url.searchParams.set('api_key', cfg.apiKey);
  url.searchParams.set('opp_key', oppKey);
  url.searchParams.set('page_size', '1');

  const json = await httpsGetJson(url, cfg.httpsAgent) as Record<string, unknown>;
  const results = Array.isArray(json.results) ? json.results : [];
  if (results.length === 0) throw new Error(`HigherGov opportunity not found: ${oppKey}`);
  return results[0] as HigherGovOpportunitySlim;
};

// ─── Fetch documents ─────────────────────────────────────────────────────────

/**
 * Fetch document download URLs for an opportunity.
 * Download URLs expire after 60 minutes — must download immediately.
 */
export const fetchHigherGovDocuments = async (
  cfg: HigherGovConfig,
  oppKey: string,
): Promise<HigherGovAttachment[]> => {
  const url = new URL('/api-external/document/', cfg.baseUrl);
  url.searchParams.set('api_key', cfg.apiKey);
  url.searchParams.set('related_key', oppKey);

  const json = await httpsGetJson(url, cfg.httpsAgent) as Record<string, unknown>;
  const results = Array.isArray(json.results) ? json.results : [];

  return results
    .map((doc: Record<string, unknown>) => ({
      url:      String(doc.download_url ?? ''),
      name:     doc.file_name ? String(doc.file_name) : undefined,
      mimeType: doc.content_type ? String(doc.content_type) : undefined,
    }))
    .filter((a: HigherGovAttachment) => a.url && /^https?:\/\//i.test(a.url));
};
```

Re-export from `apps/functions/src/helpers/search-opportunity.ts`:

```typescript
export * from './samgov';
export * from './dibbs';
export * from './highergov';   // ← add
```

### 5.2 Update search handler

**File:** `apps/functions/src/handlers/search-opportunity/search.ts`

Add `'HIGHER_GOV'` to source enum, add HigherGov branch, fix interleaving for 3 sources:

```typescript
const SearchRequestSchema = z.object({
  source: z.enum(['SAM_GOV', 'DIBBS', 'HIGHER_GOV', 'ALL']).default('ALL'),
  // ... existing fields ...
  higherGovSourceType: z.enum(['sam', 'dibbs', 'sbir', 'grant', 'sled']).optional(),
  // ... existing fields ...
});
```

Add after DIBBS block:

```typescript
  const includeHigherGov = data.source === 'ALL' || data.source === 'HIGHER_GOV';
  let totalHigherGov = 0;

  if (includeHigherGov) {
    try {
      const apiKey = await getApiKey(orgId, HIGHERGOV_SECRET_PREFIX);
      if (apiKey) {
        const postedDate = data.postedFrom
          ? `${data.postedFrom.slice(6)}-${data.postedFrom.slice(0, 2)}-${data.postedFrom.slice(3, 5)}`
          : undefined;
        const pageSize = data.limit ?? 25;

        const resp = await searchHigherGovOpportunities(
          { baseUrl: HIGHERGOV_BASE_URL, apiKey, httpsAgent },
          {
            keywords:   data.keywords,
            sourceType: data.higherGovSourceType,
            postedDate,
            ordering:   '-captured_date',
            pageSize,
            pageNumber: data.offset ? Math.floor(data.offset / pageSize) + 1 : 1,
          },
        );
        totalHigherGov = resp.totalCount;
        results.push(...resp.results.map(higherGovToSearchOpportunity));
      }
    } catch (e) {
      errors['HIGHER_GOV'] = e instanceof Error ? e.message : 'HigherGov search failed';
    }
  }
```

Replace the hardcoded SAM+DIBBS interleave with generic round-robin:

```typescript
  // Round-robin interleave across all sources
  const bySource: Record<string, SearchOpportunitySlim[]> = {};
  for (const r of results) (bySource[r.source] ??= []).push(r);
  const sourceArrays = Object.values(bySource);
  const merged: SearchOpportunitySlim[] = [];
  const maxLen = Math.max(...sourceArrays.map((a) => a.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const arr of sourceArrays) {
      if (i < arr.length) merged.push(arr[i]!);
    }
  }

  return apiResponse(200, {
    opportunities: merged,
    totalSamGov, totalDibbs, totalHigherGov,
    total: totalSamGov + totalDibbs + totalHigherGov,
    errors: Object.keys(errors).length ? errors : undefined,
  });
```

### 5.3 Update import handler

**File:** `apps/functions/src/handlers/search-opportunity/import-solicitation.ts`

Add HigherGov variant to the discriminated union:

```typescript
const ImportRequestSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('SAM_GOV'), /* ... existing ... */ }),
  z.object({ source: z.literal('DIBBS'),   /* ... existing ... */ }),
  z.object({
    source:           z.literal('HIGHER_GOV'),
    orgId:            z.string().min(1),
    projectId:        z.string().min(1),
    oppKey:           z.string().min(1),
    sourceDocumentId: z.string().optional(),
    force:            z.boolean().optional(),
  }),
]);

// In baseHandler, add routing:
if (data.source === 'SAM_GOV')    return importSamGov(event, data);
if (data.source === 'DIBBS')      return importDibbs(event, data);
if (data.source === 'HIGHER_GOV') return importHigherGov(event, data);
```

Add `importHigherGov` function (follows same pattern as `importSamGov` / `importDibbs`):

```typescript
const importHigherGov = async (
  event: AuthedEvent,
  data: Extract<ImportRequest, { source: 'HIGHER_GOV' }>,
): Promise<APIGatewayProxyResultV2> => {
  const apiKey = await getApiKey(data.orgId, HIGHERGOV_SECRET_PREFIX);
  if (!apiKey) return apiResponse(404, { message: 'HigherGov API key not configured for this organization' });

  const cfg: HigherGovConfig = { baseUrl: HIGHERGOV_BASE_URL, apiKey, httpsAgent };
  const opp = await fetchHigherGovOpportunity(cfg, data.oppKey);

  // Cross-source dedup: check higherGovOppKey AND noticeId (source_id = SAM noticeId)
  if (!data.force) {
    const existingByOppKey = await findOpportunityBySourceId({ orgId: data.orgId, higherGovOppKey: data.oppKey });
    const existingByNoticeId = opp.source_id
      ? await findOpportunityBySourceId({ orgId: data.orgId, noticeId: opp.source_id })
      : null;
    const existing = existingByOppKey ?? existingByNoticeId;

    if (existing) {
      const project = existing.projectId ? await getProjectById(existing.projectId) : null;
      return apiResponse(409, {
        message: `This opportunity has already been imported (from ${existing.source}).`,
        existing: {
          oppId: existing.oppId, projectId: existing.projectId,
          projectName: project?.name ?? null, title: existing.title,
          source: existing.source, importedBy: existing.createdByName ?? null,
          importedAt: existing.createdAt,
        },
      });
    }
  }

  const attachments = await fetchHigherGovDocuments(cfg, opp.opp_key);

  const { oppId, item } = await createOpportunity({
    orgId: data.orgId, projectId: data.projectId,
    opportunity: {
      orgId: data.orgId, projectId: data.projectId,
      source: 'HIGHER_GOV',
      id: opp.opp_key,
      title: opp.title ?? 'Untitled',
      type: opp.opp_type?.name ?? null,
      postedDateIso: opp.posted_date ? new Date(opp.posted_date).toISOString() : null,
      responseDeadlineIso: opp.due_date ? new Date(opp.due_date).toISOString() : null,
      noticeId: opp.source_id ?? null,
      solicitationNumber: null,
      naicsCode: opp.naics_code?.code ?? null,
      pscCode: opp.psc_code?.code ?? null,
      organizationName: opp.agency?.name ?? null,
      setAside: opp.set_aside ?? null,
      description: opp.ai_summary ?? opp.description_text ?? null,
      active: true,
      baseAndAllOptionsValue: opp.val_est_high ? parseFloat(opp.val_est_high) || null : null,
      higherGovOppKey: opp.opp_key,
      higherGovAiSummary: opp.ai_summary ?? null,
    },
  });

  await syncOpportunityToApn({
    orgId: data.orgId, projectId: data.projectId, oppId,
    customerName: item.organizationName ?? item.title ?? 'Unknown Customer',
    opportunityValue: item.baseAndAllOptionsValue ?? 0,
    expectedCloseDate: item.responseDeadlineIso ?? new Date().toISOString(),
    proposalStatus: 'PROSPECT',
    description: typeof item.description === 'string' ? item.description.substring(0, 500) : undefined,
  });

  const files = await importAttachments({
    orgId: data.orgId, projectId: data.projectId,
    id: opp.opp_key, attachments, oppId,
    sourceDocumentId: data.sourceDocumentId,
  });

  setAuditContext(event, {
    action: 'SOLICITATION_IMPORTED', resource: 'opportunity', resourceId: oppId, orgId: data.orgId,
    changes: { after: { source: 'HIGHER_GOV', higherGovOppKey: opp.opp_key, projectId: data.projectId, filesImported: files.length } },
  });

  const userId = getUserId(event);
  if (userId) {
    const nameMap = await resolveUserNames(data.orgId, [userId]).catch(() => ({} as Record<string, string>));
    const userName = nameMap[userId] ?? 'A user';
    await sendNotification(buildNotification(
      'SOLICITATION_IMPORTED', 'New solicitation imported',
      `${userName} imported "${opp.title}" from HigherGov`,
      { orgId: data.orgId, projectId: data.projectId, entityId: oppId, recipientUserIds: [userId] },
    ));
  }

  return apiResponse(202, {
    ok: true, source: 'HIGHER_GOV', projectId: data.projectId,
    higherGovOppKey: opp.opp_key, opportunityId: oppId,
    imported: files.length, opportunity: item, files,
  });
};
```

### 5.4 Update saved search runner

**File:** `apps/functions/src/handlers/search-opportunity/run-saved-search.ts`

Add HigherGov branch (follows SAM.gov/DIBBS pattern):

```typescript
} else if (source === 'HIGHER_GOV') {
  const hgApiKey = await getApiKey(orgId, HIGHERGOV_SECRET_PREFIX);
  if (!hgApiKey) { console.log(`[runner] No HigherGov API key for org ${orgId}`); continue; }

  const postedDate = criteria.postedFrom
    ? `${criteria.postedFrom.slice(6)}-${criteria.postedFrom.slice(0, 2)}-${criteria.postedFrom.slice(3, 5)}`
    : undefined;

  const resp = await searchHigherGovOpportunities(
    { baseUrl: HIGHERGOV_BASE_URL, apiKey: hgApiKey, httpsAgent },
    {
      keywords:   criteria.keywords,
      sourceType: criteria.higherGovSourceType,
      postedDate,
      ordering:   '-captured_date',
      pageSize:   criteria.limit ?? 25,
      pageNumber: 1,
    },
  );
  searchCount = resp.totalCount;

  if (!dryRun && s.autoImport && projectId) {
    const cap = Math.min(resp.results.length, 25);
    for (let i = 0; i < cap; i++) {
      const opp = resp.results[i];
      try {
        // Cross-source dedup
        const dup = await findOpportunityBySourceId({ orgId, higherGovOppKey: opp.opp_key });
        const dupBySam = opp.source_id ? await findOpportunityBySourceId({ orgId, noticeId: opp.source_id }) : null;
        if (dup || dupBySam) { skippedCount++; continue; }

        const attachments = await fetchHigherGovDocuments(
          { baseUrl: HIGHERGOV_BASE_URL, apiKey: hgApiKey, httpsAgent },
          opp.opp_key,
        );
        await importOpportunityFromHigherGov({ orgId, projectId, opp, attachments });
        importedCount++;
      } catch (e) {
        console.warn(`[runner] HigherGov import failed ${opp.opp_key}:`, (e as Error)?.message);
        failedCount++;
      }
    }
  }
}
```

---

## 6. REST API Routes <!-- ⏳ PENDING -->

**No new routes.** All HigherGov functionality uses existing endpoints:

| Method | Path | Handler | Change |
|---|---|---|---|
| POST | `/search-opportunities/search` | `search.ts` | Add `HIGHER_GOV` source branch |
| POST | `/search-opportunities/import-solicitation` | `import-solicitation.ts` | Add `HIGHER_GOV` discriminated union variant |
| POST | `/search-opportunities/saved-search` | `saved-search-create.ts` | No change — already supports `source` field |
| EventBridge | `run-saved-search` | `run-saved-search.ts` | Add `HIGHER_GOV` branch |

---

## 7. CDK Stack Updates <!-- ⏳ PENDING -->

### 7.1 Environment variable

Add to Lambda environment for search/import handlers:

```typescript
HIGHERGOV_BASE_URL: 'https://www.highergov.com/api-external',
```

### 7.2 No other changes

No new Lambda functions, no new log groups, no new IAM permissions. Existing shared role covers DynamoDB, S3, Secrets Manager, Step Functions.

---

## 8. Frontend <!-- ⏳ PENDING -->

### 8.1 Update search form

**File:** `apps/web/components/opportunities/SearchOpportunityForm.tsx`

Add HigherGov to source selector and show source_type filter when selected:

```typescript
const Schema = z.object({
  keywords: z.string().optional(),
  source:   z.enum(['all', 'SAM_GOV', 'DIBBS', 'HIGHER_GOV']).default('all'),  // ← add
  // ... existing fields ...
  higherGovSourceType: z.enum(['sam', 'dibbs', 'sbir', 'grant', 'sled', '']).default(''),
});
```

```tsx
<DropdownMenuRadioItem value="HIGHER_GOV">HigherGov</DropdownMenuRadioItem>
```

When HigherGov is selected, show source_type filter:

```tsx
{watchSource === 'HIGHER_GOV' && (
  <div className="space-y-1">
    <Label htmlFor="higherGovSourceType">Source Filter</Label>
    <Select {...register('higherGovSourceType')}>
      <SelectTrigger><SelectValue placeholder="All sources" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="">All sources</SelectItem>
        <SelectItem value="sbir">SBIR/STTR</SelectItem>
        <SelectItem value="grant">Grants</SelectItem>
        <SelectItem value="sled">State & Local</SelectItem>
        <SelectItem value="sam">SAM.gov</SelectItem>
        <SelectItem value="dibbs">DIBBS</SelectItem>
      </SelectContent>
    </Select>
    <p className="text-xs text-muted-foreground">
      Filter to avoid duplicating results from other sources
    </p>
  </div>
)}
```

### 8.2 Add HigherGov API key configuration

Add HigherGov entry in the organization settings API key section (existing `ApiKeyCard` component):

```tsx
<ApiKeyCard
  title="HigherGov"
  description="Connect to HigherGov to search and import government opportunities"
  prefix="highergov"
  orgId={orgId}
  helpUrl="https://docs.highergov.com/import-and-export/api"
/>
```

### 8.3 Search results table

No changes needed — the existing `SearchOpportunityResultsTable` already renders a source badge per result and handles the import click. The `source: 'HIGHER_GOV'` badge will render automatically. The import button will send `{ source: 'HIGHER_GOV', oppKey: result.id }` to `import-solicitation`.

---

## 9. Permissions & RBAC <!-- ⏳ PENDING -->

No new permissions. Reuses existing `opportunity:read` (search) and `opportunity:create` + `question:create` (import).

---

## 10. Known Limitations <!-- ⏳ PENDING -->

| Issue | Mitigation |
|---|---|
| **10K records/month quota** | Auto-import capped at 25 per saved search run. Typical search uses 25 records. |
| **Schemas are speculative** | `.passthrough()` on all HigherGov Zod schemas until validated against real API responses. |
| **Document download URLs expire in 60 min** | Downloaded immediately during import. |
| **HigherGov aggregates SAM/DIBBS** | `higherGovSourceType` filter lets users avoid duplicates. Cross-source dedup catches imports. |
| **Dedup queries all org opportunities** | Same pattern as SAM.gov/DIBBS. Consider GSI if >10K opps per org. |
| **API key in query string** | HigherGov's auth design. Key stored in Secrets Manager, never logged. |

---

## 11. Implementation Tickets <!-- ⏳ PENDING -->

### HG-1 · Core Schemas (1 hour) <!-- ⏳ PENDING -->

**Files:**
- `packages/core/src/schemas/opportunity.ts` — add `HIGHER_GOV` to source, add `higherGovOppKey` + `higherGovAiSummary`
- `packages/core/src/schemas/search-opportunity.ts` — add HigherGov slim schema, mapper, import request, `higherGovSourceType`, update `SavedSearchSourceSchema`
- `packages/core/src/schemas/index.ts` — verify exports

**Verify:** `cd packages/core && pnpm tsc --noEmit`

### HG-2 · Constants & Helper (1.5 hours) <!-- ⏳ PENDING -->

**Files:**
- `apps/functions/src/constants/highergov.ts` — new
- `apps/functions/src/helpers/highergov.ts` — new
- `apps/functions/src/helpers/search-opportunity.ts` — add re-export
- `apps/functions/src/helpers/opportunity.ts` — update `findOpportunityBySourceId`

**Verify:** `cd apps/functions && pnpm tsc --noEmit`

### HG-3 · Handler Updates (2 hours) <!-- ⏳ PENDING -->

**Files:**
- `apps/functions/src/handlers/search-opportunity/search.ts` — add HIGHER_GOV source, 3-way interleave
- `apps/functions/src/handlers/search-opportunity/import-solicitation.ts` — add HIGHER_GOV variant
- `apps/functions/src/handlers/search-opportunity/run-saved-search.ts` — add HIGHER_GOV branch

**Verify:** `cd apps/functions && pnpm tsc --noEmit`

### HG-4 · CDK Environment Variable (15 min) <!-- ⏳ PENDING -->

**Files:**
- API stack — add `HIGHERGOV_BASE_URL` env var to search/import Lambdas

**Verify:** `cd packages/infra && pnpm tsc --noEmit`

### HG-5 · Frontend (1.5 hours) <!-- ⏳ PENDING -->

**Files:**
- `apps/web/components/opportunities/SearchOpportunityForm.tsx` — add source + source_type filter
- Organization settings API key page — add HigherGov API key card

**Verify:** `cd apps/web && npx tsc --noEmit`

### HG-6 · Tests (1.5 hours) <!-- ⏳ PENDING -->

**Files:**
- `apps/functions/src/helpers/highergov.test.ts`
- `packages/core/src/schemas/search-opportunity.test.ts` — add HigherGov schema + mapper tests

**Verify:** `pnpm test`

---

## 12. Acceptance Criteria <!-- ⏳ PENDING -->

- [ ] User can configure HigherGov API key in organization settings
- [ ] User can select "HigherGov" as a source in search
- [ ] User can filter HigherGov by source_type (SBIR, grants, SLED, etc.)
- [ ] User can import individual HigherGov opportunities with documents
- [ ] User can save a HigherGov search as an AutoRFP saved search with auto-import
- [ ] Cross-source dedup catches SAM.gov/HigherGov overlaps
- [ ] HigherGov AI summaries stored on imported opportunities
- [ ] Audit trail records HigherGov imports

---

## 13. Summary of Changes <!-- ⏳ PENDING -->

### New files (3)

| File | Purpose | Status |
|---|---|---|
| `apps/functions/src/constants/highergov.ts` | Secret prefix, base URL | ⏳ |
| `apps/functions/src/helpers/highergov.ts` | HigherGov API client | ⏳ |
| `apps/functions/src/helpers/highergov.test.ts` | Helper tests | ⏳ |

### Modified files (8)

| File | Change |
|---|---|
| `packages/core/src/schemas/opportunity.ts` | Add `HIGHER_GOV` to source, add 2 optional fields |
| `packages/core/src/schemas/search-opportunity.ts` | Add HigherGov schemas, mapper, import request, `higherGovSourceType` |
| `apps/functions/src/helpers/search-opportunity.ts` | Re-export from `highergov.ts` |
| `apps/functions/src/helpers/opportunity.ts` | Cross-source dedup in `findOpportunityBySourceId` |
| `apps/functions/src/handlers/search-opportunity/search.ts` | Add HIGHER_GOV branch, generic interleave |
| `apps/functions/src/handlers/search-opportunity/import-solicitation.ts` | Add HIGHER_GOV import variant |
| `apps/functions/src/handlers/search-opportunity/run-saved-search.ts` | Add HIGHER_GOV auto-import branch |
| `apps/web/components/opportunities/SearchOpportunityForm.tsx` | Add source option + source_type filter |
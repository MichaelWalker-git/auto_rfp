# HOR-2610 · Auto-Find Past Related RFPs from Solicitation Organization (HigherGov)

> Implementation-ready architecture doc. Follow the layer order (core → constants/helpers → handlers → CDK → frontend). Update the status badges as tickets land.

---

## 1. Overview <!-- ⏳ PENDING -->

| | |
|---|---|
| **Linear** | [HOR-2610](https://linear.app/horustech/issue/HOR-2610) — related to [HOR-2609](https://linear.app/horustech/issue/HOR-2609) (FOIA automation, downstream) |
| **Branch** | `ivan/hor-2610-auto-find-past-related-rfps-from-solicitation-organization` |
| **Goal** | For a HigherGov-sourced opportunity, automatically find the issuing agency's past/present RFPs, rank the most relevant, and surface them as lightweight **link records** on the RFP detail page. Users can manually add; admins can remove auto-added links. |
| **Non-goal (v1)** | Full-importing past RFPs as `OpportunityItem`s (would flood the pipeline board with stage-less imports — see the `RFP_SYNC_PROJECT_ID` scoping lesson). Non-HigherGov opportunities (SAM.gov / DIBBS / manual). |

### Locked design decisions (from grilling session 2026-08-14)

| Decision | Choice |
|---|---|
| Data source | Official HigherGov REST API filtered by `agency_key` — **not** page scraping. Reuse per-org key via `getApiKey(orgId, 'highergov')`. |
| v1 scope | HigherGov-sourced opps only (current opp must have `higherGovOppKey`). |
| Link anchor | Opportunity-level (`oppId`). |
| Match logic | Fetch by `agency_key`, rank client-side by keyword overlap on title/description; NAICS/PSC as tiebreaker boost (not a hard filter). Keep **top 5** above threshold. |
| Trigger | Async auto-find after import via **fire-and-forget async Lambda invoke** (no new infra) + manual refresh endpoint. Matches land directly as `origin=AUTO`. |
| Representation | New lightweight `RELATED_RFP` link entity — no full import. |
| Dedup | If a match is already imported in the org (by `higherGovOppKey`/`noticeId`), keep it in the list but **cross-link** to the in-app `OpportunityItem`. |
| Refresh | Replaces `AUTO` links only; never touches `MANUAL` adds or admin removals. |
| Suppression | Removed `oppKey`s are tombstoned so refresh won't re-add them. |
| Remove RBAC | Admin-only for `AUTO` links (honors ticket's "admin role only"); any RFP editor removes their own `MANUAL` adds. |
| Manual add | Agency-history picker (dedicated `agency-history` endpoint, keeps agency search out of the shared search contract). |
| UI | "Related RFPs" stacked section on the opportunity detail page. |

---

## 2. Architecture Overview <!-- ⏳ PENDING -->

```
                    ┌──────────────────────────────────────────────────────────┐
                    │  import-solicitation.ts (source: HIGHER_GOV)              │
                    │  … createOpportunity() …                                  │
                    │  └─► async Lambda.invoke(find-related-rfps, Event)  ──────┼──┐
                    └──────────────────────────────────────────────────────────┘  │  fire-and-forget
                                                                                    ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────┐
   │  find-related-rfps  (async worker Lambda — NOT API-Gateway fronted)                    │
   │  1. load OpportunityItem (orgId, projectId, oppId)                                     │
   │  2. guard: higherGovOppKey present? else no-op                                         │
   │  3. fetchHigherGovOpportunity(higherGovOppKey) → resolve agency.agency_key             │
   │  4. searchHigherGovOpportunities({ agencyKey, pageSize: 100 })                         │
   │  5. rankRelatedRfps(current, candidates) → top 5 above threshold                       │
   │  6. filter out current opp + suppressed oppKeys                                        │
   │  7. cross-link: findOpportunityBySourceId(higherGovOppKey/noticeId) per match          │
   │  8. deleteAutoRelatedRfps(prefix) then createRelatedRfp(...) for each (origin=AUTO)     │
   └──────────────────────────────────────────────────────────────────────────────────────┘

   REST (Cognito) — related-rfp domain
   GET    /related-rfps                 → list-related-rfps      (?orgId&projectId&oppId)
   POST   /related-rfps                 → create-related-rfp     (manual add, origin=MANUAL)
   POST   /related-rfps/refresh         → refresh-related-rfps   (re-invokes worker, 202)
   DELETE /related-rfps/{relatedOppKey} → delete-related-rfp     (AUTO=admin+tombstone, MANUAL=editor)
   GET    /related-rfps/agency-history  → agency-history         (picker: agency_key search)
                                   │
                                   ▼
   apps/web/features/related-rfp → <RelatedRfpsSection> mounted in OpportunityView.tsx
```

| Decision | Choice | Why |
|---|---|---|
| Async trigger | `LambdaClient.invoke` with `InvocationType: 'Event'` | No new infra; import stays fast; best-effort feature. |
| Worker not routed | Standalone Lambda invoked async only | Avoids the API Gateway 29s cap; import handler owns the trigger. |
| Store | Separate single-table items (`RELATED_RFP`) | Per-row add/remove + RBAC + audit; no 400 KB item bloat on `OpportunityItem`. |
| Match ranking | Client-side keyword overlap (API has no free-text search) | Consistent with existing `searchHigherGovOpportunities` client-side filter approach. |

---

## 3. Data Models & Zod Schemas <!-- ⏳ PENDING -->

**New file:** `packages/core/src/schemas/related-rfp.ts`

```typescript
import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants';

// Origin of a related-RFP link.
export const RelatedRfpOriginSchema = z.enum(['AUTO', 'MANUAL']);
export type RelatedRfpOrigin = z.infer<typeof RelatedRfpOriginSchema>;

// 1. Create request — server-managed fields (id, audit) omitted.
export const RelatedRfpCreateRequestSchema = z.object({
  orgId:            z.string().min(1),
  projectId:        z.string().min(1),
  oppId:            z.string().min(1),
  /** HigherGov opp_key of the related past RFP. */
  relatedOppKey:    z.string().min(1),
  title:            z.string().min(1),
  organizationName: z.string().nullish(),
  postedDateIso:    z.string().nullish(),
  dueDateIso:       z.string().nullish(),
  /** HigherGov listing URL (used when the match is NOT already imported). */
  sourceUrl:        z.string().nullish(),
  /** 0..1 relevance score from ranking (absent for manual adds). */
  matchScore:       z.number().min(0).max(1).nullish(),
  origin:           RelatedRfpOriginSchema.default('MANUAL'),
});
export type RelatedRfpCreateRequest = z.infer<typeof RelatedRfpCreateRequestSchema>;

// 2. Update request — partial, identifiers not patchable.
export const RelatedRfpUpdateRequestSchema = RelatedRfpCreateRequestSchema
  .partial()
  .omit({ orgId: true, projectId: true, oppId: true, relatedOppKey: true });
export type RelatedRfpUpdateRequest = z.infer<typeof RelatedRfpUpdateRequestSchema>;

// 3. Item — pure domain entity (NO db keys).
export const RelatedRfpItemSchema = RelatedRfpCreateRequestSchema.extend({
  id: z.string(),
  /**
   * When the related RFP is ALREADY imported in this org, the in-app
   * OpportunityItem.oppId to deep-link to (cross-link dedup). Null → link out
   * to sourceUrl (HigherGov) instead.
   */
  linkedOpportunityId: z.string().nullish(),
  createdAt:     z.string().datetime().optional(),
  updatedAt:     z.string().datetime().optional(),
  createdBy:     z.string().optional(),
  createdByName: z.string().optional(),
});
export type RelatedRfpItem = z.infer<typeof RelatedRfpItemSchema>;

// 4. DBItem — Item + single-table keys.
export const RelatedRfpDBItemSchema = RelatedRfpItemSchema.extend({
  [PK_NAME]: z.string(),
  [SK_NAME]: z.string(),
});
export type RelatedRfpDBItem = z.infer<typeof RelatedRfpDBItemSchema>;

// 5. ListItem — lightweight projection for the detail-page card.
export const RelatedRfpListItemSchema = z.object({
  id:                  z.string(),
  relatedOppKey:       z.string(),
  title:               z.string(),
  organizationName:    z.string().nullish(),
  postedDateIso:       z.string().nullish(),
  dueDateIso:          z.string().nullish(),
  sourceUrl:           z.string().nullish(),
  matchScore:          z.number().nullish(),
  origin:              RelatedRfpOriginSchema,
  linkedOpportunityId: z.string().nullish(),
  createdAt:           z.string().datetime().optional(),
  createdByName:       z.string().optional(),
});
export type RelatedRfpListItem = z.infer<typeof RelatedRfpListItemSchema>;

// ── Suppression (tombstone) record ──────────────────────────────────────────
// One per (opp, removed oppKey) so refresh never re-adds an admin-removed match.
export const RelatedRfpSuppressionItemSchema = z.object({
  orgId:         z.string(),
  projectId:     z.string(),
  oppId:         z.string(),
  relatedOppKey: z.string(),
  createdAt:     z.string().datetime().optional(),
  createdBy:     z.string().optional(),
});
export type RelatedRfpSuppressionItem = z.infer<typeof RelatedRfpSuppressionItemSchema>;

export const RelatedRfpSuppressionDBItemSchema = RelatedRfpSuppressionItemSchema.extend({
  [PK_NAME]: z.string(),
  [SK_NAME]: z.string(),
});
export type RelatedRfpSuppressionDBItem = z.infer<typeof RelatedRfpSuppressionDBItemSchema>;

// ── Response shapes ──────────────────────────────────────────────────────────
export const RelatedRfpsResponseSchema = z.object({
  items: z.array(RelatedRfpListItemSchema),
});
export type RelatedRfpsResponse = z.infer<typeof RelatedRfpsResponseSchema>;

export const RelatedRfpResponseSchema = z.object({ item: RelatedRfpItemSchema });
export type RelatedRfpResponse = z.infer<typeof RelatedRfpResponseSchema>;

// Agency-history search result (picker) — reuses the HigherGov wire shape subset.
export const AgencyHistoryItemSchema = z.object({
  relatedOppKey:       z.string(),
  title:               z.string(),
  organizationName:    z.string().nullish(),
  postedDateIso:       z.string().nullish(),
  dueDateIso:          z.string().nullish(),
  sourceUrl:           z.string().nullish(),
  linkedOpportunityId: z.string().nullish(),
  alreadyRelated:      z.boolean().default(false),
});
export type AgencyHistoryItem = z.infer<typeof AgencyHistoryItemSchema>;

export const AgencyHistoryResponseSchema = z.object({ items: z.array(AgencyHistoryItemSchema) });
export type AgencyHistoryResponse = z.infer<typeof AgencyHistoryResponseSchema>;
```

**Edit:** `packages/core/src/schemas/index.ts` → add `export * from './related-rfp';`

**Verify:** `cd packages/core && pnpm build`

---

## 4. DynamoDB Design <!-- ⏳ PENDING -->

### PK constants — **New file** `apps/functions/src/constants/related-rfp.ts`

```typescript
export const RELATED_RFP_PK = 'RELATED_RFP' as const;
export const RELATED_RFP_SUPPRESSION_PK = 'RELATED_RFP_SUPPRESSION' as const;

/** Max auto-linked related RFPs kept per opportunity (conscious tight floor for v1). */
export const MAX_AUTO_RELATED = 5;
/** Minimum relevance score (0..1) for an auto match to be kept. */
export const RELATED_MATCH_THRESHOLD = 0.15;
/** Page size to pull from HigherGov before client-side ranking. */
export const AGENCY_FETCH_PAGE_SIZE = 100;
```

### Access patterns

| Entity | PK | SK | Notes |
|---|---|---|---|
| Related RFP link | `RELATED_RFP` | `{orgId}#{projectId}#{oppId}#{relatedOppKey}` | List by SK prefix `{orgId}#{projectId}#{oppId}` |
| Suppression tombstone | `RELATED_RFP_SUPPRESSION` | `{orgId}#{projectId}#{oppId}#{relatedOppKey}` | List by same prefix |

### SK builders + DB helpers — **New file** `apps/functions/src/helpers/related-rfp.ts`

```typescript
import { randomUUID } from 'crypto';
import {
  createItem, deleteItem, queryBySkPrefix,
} from '@/helpers/db';
import { RELATED_RFP_PK, RELATED_RFP_SUPPRESSION_PK } from '@/constants/related-rfp';
import type {
  RelatedRfpDBItem, RelatedRfpItem, RelatedRfpCreateRequest,
  RelatedRfpSuppressionDBItem,
} from '@auto-rfp/core';

// ── SK builders (pure) ────────────────────────────────────────────────────────
export const buildRelatedRfpSk = (orgId: string, projectId: string, oppId: string, relatedOppKey: string) =>
  `${orgId}#${projectId}#${oppId}#${relatedOppKey}`;

export const buildRelatedRfpSkPrefix = (orgId: string, projectId: string, oppId: string) =>
  `${orgId}#${projectId}#${oppId}`;

// ── DB helpers (wrap @/helpers/db) ─────────────────────────────────────────────
export const listRelatedRfps = async (
  orgId: string, projectId: string, oppId: string,
): Promise<RelatedRfpDBItem[]> =>
  queryBySkPrefix<RelatedRfpDBItem>(RELATED_RFP_PK, buildRelatedRfpSkPrefix(orgId, projectId, oppId));

export const createRelatedRfp = async (
  dto: RelatedRfpCreateRequest & { linkedOpportunityId?: string | null; createdBy?: string; createdByName?: string },
): Promise<RelatedRfpItem> => {
  const now = new Date().toISOString();
  const item: RelatedRfpDBItem = {
    partition_key: RELATED_RFP_PK,
    sort_key: buildRelatedRfpSk(dto.orgId, dto.projectId, dto.oppId, dto.relatedOppKey),
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...dto,
  };
  await createItem(item);
  const { partition_key, sort_key, ...rest } = item;
  return rest;
};

export const deleteRelatedRfp = async (orgId: string, projectId: string, oppId: string, relatedOppKey: string) =>
  deleteItem(RELATED_RFP_PK, buildRelatedRfpSk(orgId, projectId, oppId, relatedOppKey));

/** Refresh support — remove only AUTO links, leaving MANUAL adds intact. */
export const deleteAutoRelatedRfps = async (orgId: string, projectId: string, oppId: string): Promise<void> => {
  const existing = await listRelatedRfps(orgId, projectId, oppId);
  await Promise.all(
    existing.filter((r) => r.origin === 'AUTO')
      .map((r) => deleteRelatedRfp(orgId, projectId, oppId, r.relatedOppKey)),
  );
};

// ── Suppression tombstones ──────────────────────────────────────────────────
export const addSuppression = async (
  orgId: string, projectId: string, oppId: string, relatedOppKey: string, createdBy?: string,
): Promise<void> => {
  const item: RelatedRfpSuppressionDBItem = {
    partition_key: RELATED_RFP_SUPPRESSION_PK,
    sort_key: buildRelatedRfpSk(orgId, projectId, oppId, relatedOppKey),
    orgId, projectId, oppId, relatedOppKey,
    createdAt: new Date().toISOString(),
    createdBy,
  };
  await createItem(item);
};

export const listSuppressedOppKeys = async (
  orgId: string, projectId: string, oppId: string,
): Promise<Set<string>> => {
  const rows = await queryBySkPrefix<RelatedRfpSuppressionDBItem>(
    RELATED_RFP_SUPPRESSION_PK, buildRelatedRfpSkPrefix(orgId, projectId, oppId),
  );
  return new Set(rows.map((r) => r.relatedOppKey));
};
```

> Confirm the exact `queryBySkPrefix` / `createItem` / `deleteItem` signatures in `@/helpers/db.ts` and adjust the generic usage to match the existing helpers (e.g. `createOpportunity` in `helpers/opportunity.ts`).

**Verify:** `cd apps/functions && pnpm tsc --noEmit`

---

## 5. Ranking & Agency Resolution (helper) <!-- ⏳ PENDING -->

Add to `apps/functions/src/helpers/related-rfp.ts`:

```typescript
import type { HigherGovOpportunitySearchResult, OpportunityDBItem } from '@auto-rfp/core';
import { buildAgencyLabel } from '@auto-rfp/core';
import { RELATED_MATCH_THRESHOLD, MAX_AUTO_RELATED } from '@/constants/related-rfp';

const STOPWORDS = new Set(['the','and','for','with','of','to','a','an','in','on','rfp','rfq','services','contract']);

const tokenize = (s?: string | null): Set<string> =>
  new Set((s ?? '').toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((t) => !STOPWORDS.has(t)) ?? []);

/**
 * Relevance score (0..1): Jaccard-ish keyword overlap of title+description,
 * with a small boost when NAICS or PSC codes match. NAICS/PSC are a TIEBREAKER,
 * never a hard filter (agency coding is inconsistent).
 */
export const scoreCandidate = (
  current: { title?: string | null; description?: string | null; naicsCode?: string | null; pscCode?: string | null },
  cand: HigherGovOpportunitySearchResult,
): number => {
  const a = new Set([...tokenize(current.title), ...tokenize(current.description)]);
  const b = new Set([...tokenize(cand.title), ...tokenize(cand.description_text), ...tokenize(cand.ai_summary)]);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap++;
  const jaccard = overlap / (a.size + b.size - overlap);
  const naicsBoost = current.naicsCode && cand.naics_code?.naics_code === current.naicsCode ? 0.1 : 0;
  const pscBoost   = current.pscCode  && cand.psc_code?.psc_code   === current.pscCode  ? 0.1 : 0;
  return Math.min(1, jaccard + naicsBoost + pscBoost);
};

export const rankRelatedRfps = (
  current: Parameters<typeof scoreCandidate>[0],
  candidates: HigherGovOpportunitySearchResult[],
  currentOppKey: string,
  suppressed: Set<string>,
): Array<{ cand: HigherGovOpportunitySearchResult; score: number }> =>
  candidates
    .filter((c) => c.opp_key !== currentOppKey && !suppressed.has(c.opp_key))
    .map((c) => ({ cand: c, score: scoreCandidate(current, c) }))
    .filter((x) => x.score >= RELATED_MATCH_THRESHOLD)
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_AUTO_RELATED);
```

> **Key gotcha:** `agency_key` is **NOT** stored on `OpportunityItem` — only `higherGovOppKey`. The worker must first call `fetchHigherGovOpportunity(higherGovOppKey)` to read `agency.agency_key`, then pass it to `searchHigherGovOpportunities({ agencyKey })`.

---

## 6. Backend — Lambda Handlers <!-- ⏳ PENDING -->

```
apps/functions/src/handlers/related-rfp/
├── find-related-rfps.ts        # async worker (invoked, not routed)
├── find-related-rfps.test.ts
├── list-related-rfps.ts        # GET
├── list-related-rfps.test.ts
├── create-related-rfp.ts       # POST (manual add)
├── create-related-rfp.test.ts
├── refresh-related-rfps.ts     # POST (re-invoke worker)
├── refresh-related-rfps.test.ts
├── delete-related-rfp.ts       # DELETE (AUTO=admin+tombstone / MANUAL=editor)
├── delete-related-rfp.test.ts
├── agency-history.ts           # GET (picker search)
└── agency-history.test.ts
```

### 6.1 `find-related-rfps.ts` (async worker)

Not fronted by API Gateway — invoked with `InvocationType: 'Event'`. Event payload: `{ orgId, projectId, oppId }`. Business logic lives in an exported `findRelatedRfpsForOpportunity` function (test this directly).

```typescript
import { getOpportunityById } from '@/helpers/opportunity';         // confirm exact name
import { getApiKey } from '@/helpers/api-key-storage';
import { HIGHERGOV_SECRET_PREFIX, HIGHERGOV_BASE_URL } from '@/constants/highergov';
import { fetchHigherGovOpportunity, searchHigherGovOpportunities, type HigherGovConfig } from '@/helpers/highergov';
import { findOpportunityBySourceId } from '@/helpers/opportunity';
import {
  rankRelatedRfps, deleteAutoRelatedRfps, createRelatedRfp, listSuppressedOppKeys,
} from '@/helpers/related-rfp';
import { AGENCY_FETCH_PAGE_SIZE } from '@/constants/related-rfp';
import { buildAgencyLabel } from '@auto-rfp/core';
import https from 'https';

const httpsAgent = new https.Agent({ keepAlive: true });

export const findRelatedRfpsForOpportunity = async (
  input: { orgId: string; projectId: string; oppId: string },
): Promise<{ created: number; skippedReason?: string }> => {
  const { orgId, projectId, oppId } = input;
  const opp = await getOpportunityById(orgId, projectId, oppId);
  if (!opp) return { created: 0, skippedReason: 'opportunity-not-found' };
  if (!opp.higherGovOppKey) return { created: 0, skippedReason: 'not-highergov-sourced' };

  const apiKey = await getApiKey(orgId, HIGHERGOV_SECRET_PREFIX);
  if (!apiKey) return { created: 0, skippedReason: 'no-highergov-key' };

  const cfg: HigherGovConfig = { baseUrl: HIGHERGOV_BASE_URL, apiKey, httpsAgent };

  // 1. resolve agency_key (not stored on our record)
  const source = await fetchHigherGovOpportunity(cfg, opp.higherGovOppKey);
  const agencyKey = source.agency?.agency_key != null ? String(source.agency.agency_key) : undefined;
  if (!agencyKey) return { created: 0, skippedReason: 'no-agency-key' };

  // 2. fetch agency history + rank
  const { results } = await searchHigherGovOpportunities(cfg, { agencyKey, pageSize: AGENCY_FETCH_PAGE_SIZE });
  const suppressed = await listSuppressedOppKeys(orgId, projectId, oppId);
  const ranked = rankRelatedRfps(
    { title: opp.title, description: opp.description, naicsCode: opp.naicsCode, pscCode: opp.pscCode },
    results, opp.higherGovOppKey, suppressed,
  );

  // 3. replace AUTO links only, then persist with cross-link dedup
  await deleteAutoRelatedRfps(orgId, projectId, oppId);
  let created = 0;
  for (const { cand, score } of ranked) {
    const existing =
      (await findOpportunityBySourceId({ orgId, higherGovOppKey: cand.opp_key })) ??
      (cand.source_id ? await findOpportunityBySourceId({ orgId, noticeId: cand.source_id }) : undefined);
    await createRelatedRfp({
      orgId, projectId, oppId,
      relatedOppKey: cand.opp_key,
      title: cand.title ?? 'Untitled',
      organizationName: buildAgencyLabel(cand.agency),
      postedDateIso: cand.posted_date ?? null,
      dueDateIso: cand.due_date ?? null,
      sourceUrl: cand.source_path ?? cand.path ?? null,
      matchScore: score,
      origin: 'AUTO',
      linkedOpportunityId: existing?.oppId ?? null,
    });
    created++;
  }
  return { created };
};

// Lambda entrypoint — async invoke (no middy / apiResponse; not routed).
export const handler = async (event: { orgId: string; projectId: string; oppId: string }) =>
  findRelatedRfpsForOpportunity(event);
```

### 6.2 `list-related-rfps.ts` (GET)

Thin: `orgId`/`projectId`/`oppId` from `queryStringParameters`, `listRelatedRfps` → `apiResponse(200, { items })`. Middy stack + `requirePermission('opportunity:read')`.

### 6.3 `create-related-rfp.ts` (POST, manual add)

`RelatedRfpCreateRequestSchema.safeParse` (force `origin: 'MANUAL'` server-side — ignore any client-sent AUTO). `orgId` from body. Cross-link dedup like the worker. `requirePermission('opportunity:edit')`.

### 6.4 `refresh-related-rfps.ts` (POST)

Validate `{ orgId, projectId, oppId }`, `LambdaClient.invoke({ FunctionName: FIND_RELATED_FN, InvocationType: 'Event', Payload })`, return `apiResponse(202, { ok: true })`. `requirePermission('opportunity:edit')`.

### 6.5 `delete-related-rfp.ts` (DELETE) — **RBAC split**

`relatedOppKey` from path, `orgId`/`projectId`/`oppId` from query. Load the link:
- `origin === 'AUTO'` → require **admin** permission (`related_rfp:remove_auto`, see §7). On success also `addSuppression(...)` (tombstone) so refresh won't re-add.
- `origin === 'MANUAL'` → `requirePermission('opportunity:edit')`.

Because RBAC is a middy `requirePermission`, do the AUTO/MANUAL gate check **inside** the handler after loading the record (both permissions attached is fine; enforce the stricter one in code), OR split into two routes. Simpler: attach `opportunity:edit` at the route, load the record, and if `origin === 'AUTO'` check `event.rbac` for the admin permission and return `403` otherwise.

### 6.6 `agency-history.ts` (GET, picker)

`orgId`/`projectId`/`oppId` (+ optional `keywords`) from query. Resolve `agency_key` via the current opp's `higherGovOppKey` (same as worker), `searchHigherGovOpportunities({ agencyKey, keywords })`, mark `alreadyRelated` against existing links, `apiResponse(200, { items })`. `requirePermission('opportunity:read')`.

**Verify:** `cd apps/functions && pnpm tsc --noEmit && pnpm test -- --testPathPattern=handlers/related-rfp`

---

## 7. Permissions & RBAC <!-- ⏳ PENDING -->

**Edit:** `packages/core/src/schemas/user.ts`

Add to `OPPORTUNITY_PERMISSIONS`:
```typescript
  // Remove an AUTO-added related RFP link — admin only (HOR-2610 acceptance criterion).
  'related_rfp:remove_auto',
```
It flows into `ALL_PERMISSIONS` automatically. Since `ADMIN: [...ALL_PERMISSIONS]`, admins get it; **do not** add it to `EDITOR`/`MEMBER`/`VIEWER`, which enforces admin-only.

| Action | Permission | Roles |
|---|---|---|
| List related RFPs | `opportunity:read` | all |
| Manual add | `opportunity:edit` | EDITOR, ADMIN, (MEMBER if granted) |
| Remove MANUAL | `opportunity:edit` | EDITOR, ADMIN |
| Remove AUTO | `related_rfp:remove_auto` | **ADMIN only** |
| Refresh | `opportunity:edit` | EDITOR, ADMIN |

**Verify:** rebuild core; ensure existing user-schema tests still pass.

---

## 8. REST API Routes & CDK <!-- ⏳ PENDING -->

**New file:** `packages/infra/api/routes/related-rfp.routes.ts`

```typescript
import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const relatedRfpDomain = (): DomainRoutes => ({
  basePath: 'related-rfps',
  routes: [
    { method: 'GET',    path: '',                 entry: lambdaEntry('related-rfp/list-related-rfps.ts') },
    { method: 'POST',   path: '',                 entry: lambdaEntry('related-rfp/create-related-rfp.ts') },
    { method: 'POST',   path: 'refresh',          entry: lambdaEntry('related-rfp/refresh-related-rfps.ts') },
    { method: 'DELETE', path: '{relatedOppKey}',  entry: lambdaEntry('related-rfp/delete-related-rfp.ts') },
    { method: 'GET',    path: 'agency-history',    entry: lambdaEntry('related-rfp/agency-history.ts'), timeoutSeconds: 30 },
  ],
});
```

**Edit:** `packages/infra/api/api-orchestrator-stack.ts` — add import + append to `allDomains` and `domainStackNames` (same index).

### Async worker Lambda (not routed)

In the appropriate stack (co-locate with the search/opportunity Lambdas):
- Define `auto-rfp-find-related-rfps-${stage}` (128 MB, ~30 s timeout, reuse `commonLambdaRole`).
- Explicit `logs.LogGroup` — `retention: stage === 'prod' ? INFINITE : TWO_WEEKS`, `removalPolicy: DESTROY`.
- Env: `HIGHERGOV_BASE_URL`, `DB_TABLE_NAME`, `REGION`.
- Grant the **import-solicitation** Lambda and **refresh** Lambda `lambda:InvokeFunction` on it; pass its name via env var `FIND_RELATED_FN` to both.

**Edit:** `import-solicitation.ts` `importHigherGov(...)` — after `createOpportunity(...)` (and before/after the `apiResponse(202, ...)`), fire-and-forget:
```typescript
// Best-effort: kick off related-RFP discovery. Never blocks or fails the import.
try {
  await lambdaClient.send(new InvokeCommand({
    FunctionName: process.env.FIND_RELATED_FN!,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({ orgId: data.orgId, projectId: data.projectId, oppId })),
  }));
} catch (e) { /* log + swallow */ }
```

**Verify:** `cd packages/infra && pnpm tsc --noEmit`

---

## 9. Frontend — Hooks & Components <!-- ⏳ PENDING -->

```
apps/web/features/related-rfp/
├── hooks/
│   ├── useRelatedRfps.ts          # SWR list, keyed on oppId
│   ├── useRelatedRfpMutations.ts  # add / remove / refresh via apiMutate + mutate()
│   └── useAgencyHistory.ts        # picker search
├── components/
│   ├── RelatedRfpsSection.tsx     # the stacked section/card
│   ├── RelatedRfpRow.tsx          # one link row (cross-link vs external)
│   └── AddRelatedRfpDialog.tsx    # agency-history picker
└── index.ts                       # barrel
```

- `'use client'` on all. Types from `@auto-rfp/core`. SWR + `authenticatedFetcher`.
- `RelatedRfpRow`: if `linkedOpportunityId` → `<Link>` to the in-app opportunity; else external `<a>` to `sourceUrl`. Show an "Imported" badge on cross-linked rows and an origin badge (`Auto` / `Manual`).
- Per-row remove: show for MANUAL to editors; for AUTO only when the user holds `related_rfp:remove_auto` (gate via the existing permission hook).
- Loading → `<Skeleton>`. Empty states: "No related RFPs found yet" (HigherGov opp) / "Connect HigherGov to enable related RFPs" (no key or non-HigherGov opp).
- Shadcn UI only (`Card`, `Button`, `Badge`, `Dialog`, `Input`).

**Mount:** in `apps/web/components/opportunities/OpportunityView.tsx`, add a `related-rfps` nav item (alongside `executive-brief`, `solicitation-documents`, …) and render:
```tsx
<section id="related-rfps" className="scroll-mt-4">
  <RelatedRfpsSection orgId={orgId} projectId={projectId} oppId={oppId} isHigherGov={!!opp.higherGovOppKey} />
</section>
```

**Verify:** `cd apps/web && npx tsc --noEmit`

---

## 10. Implementation Tickets <!-- ⏳ PENDING -->

| # | Ticket | Files | Est |
|---|---|---|---|
| RR-1 | Core schemas | `related-rfp.ts` + index export | 45 min <!-- ⏳ --> |
| RR-2 | Constants + DB/ranking helpers (+ unit tests for `scoreCandidate`/`rankRelatedRfps`) | `constants/related-rfp.ts`, `helpers/related-rfp.ts` | 2 h <!-- ⏳ --> |
| RR-3 | Async worker `find-related-rfps` + tests | `handlers/related-rfp/find-related-rfps.ts` | 2 h <!-- ⏳ --> |
| RR-4 | CRUD handlers (list/create/refresh/delete) + agency-history + tests | `handlers/related-rfp/*` | 3 h <!-- ⏳ --> |
| RR-5 | Permission `related_rfp:remove_auto` | `user.ts` | 20 min <!-- ⏳ --> |
| RR-6 | Routes + orchestrator registration + worker Lambda + IAM + import hook | `related-rfp.routes.ts`, `api-orchestrator-stack.ts`, stack, `import-solicitation.ts` | 2 h <!-- ⏳ --> |
| RR-7 | Frontend feature module + mount in OpportunityView | `features/related-rfp/*`, `OpportunityView.tsx` | 3 h <!-- ⏳ --> |
| RR-8 | Component + e2e smoke tests | `__tests__`, Playwright | 1.5 h <!-- ⏳ --> |

---

## 11. Acceptance Criteria Checklist <!-- ⏳ PENDING -->

- [ ] System pulls the solicitation organization's bid history via HigherGov `agency_key`
- [ ] Keyword ranking runs automatically after a HigherGov opp is imported (async)
- [ ] Related past RFPs are shown on the RFP detail page, linked to the current RFP
- [ ] Already-imported matches cross-link to the in-app opportunity
- [ ] User can manually add a past RFP as related (agency-history picker)
- [ ] User can manually remove an auto-added RFP — **admin role only** (`related_rfp:remove_auto`)
- [ ] Editors can remove their own manual adds
- [ ] Manual refresh replaces AUTO links only; admin removals are tombstoned and don't reappear
- [ ] Graceful empty state when the org has no HigherGov key / opp is non-HigherGov
- [ ] `pnpm tsc --noEmit` passes in core, functions, infra, web; new tests green

---

## 12. Summary of New Files <!-- ⏳ PENDING -->

| File | Purpose | Status |
|---|---|---|
| `packages/core/src/schemas/related-rfp.ts` | Entity + suppression + response schemas | ⏳ |
| `apps/functions/src/constants/related-rfp.ts` | PK constants, limits, threshold | ⏳ |
| `apps/functions/src/helpers/related-rfp.ts` | SK builders, DB helpers, ranking, agency resolve | ⏳ |
| `apps/functions/src/handlers/related-rfp/find-related-rfps.ts` | Async discovery worker | ⏳ |
| `apps/functions/src/handlers/related-rfp/list-related-rfps.ts` | GET list | ⏳ |
| `apps/functions/src/handlers/related-rfp/create-related-rfp.ts` | POST manual add | ⏳ |
| `apps/functions/src/handlers/related-rfp/refresh-related-rfps.ts` | POST refresh (re-invoke worker) | ⏳ |
| `apps/functions/src/handlers/related-rfp/delete-related-rfp.ts` | DELETE (RBAC split + tombstone) | ⏳ |
| `apps/functions/src/handlers/related-rfp/agency-history.ts` | GET picker search | ⏳ |
| `packages/infra/api/routes/related-rfp.routes.ts` | REST routes | ⏳ |
| `apps/web/features/related-rfp/**` | Hooks, components, barrel | ⏳ |

**Edited files:** `packages/core/src/schemas/index.ts`, `packages/core/src/schemas/user.ts`, `packages/infra/api/api-orchestrator-stack.ts`, one infra stack (worker Lambda + IAM), `apps/functions/src/handlers/search-opportunity/import-solicitation.ts`, `apps/web/components/opportunities/OpportunityView.tsx`.
```

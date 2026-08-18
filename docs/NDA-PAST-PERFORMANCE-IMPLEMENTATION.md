# NDA / Permission-Required Past-Performance Disclosure Flags — Implementation

> Ticket: **Past-performance disclosure flags (NDA / permission-required clients)**
> Branch: `feature/nda-past-performance`
> Author: architecture pass (Kateryna K. + Michael to review)

---

## 1. Overview <!-- ✅ IMPLEMENTED -->

| | |
|---|---|
| **Problem** | `PastProjectSchema` has ~30 fields but no way to record "this client may not be named." NDA-bound / permission-blocked clients can reach a generated proposal, brief, or Q&A answer. The only current safeguard is manual review. |
| **Goal** | Every past project carries a `disclosure` classification. Matching excludes `DO_NOT_USE`; any non-`NAMEABLE` project has its client name (and other identifying fields) redacted before it can reach an LLM or a generated document. |
| **Fail-closed** | All new and existing records default to `PERMISSION_REQUIRED`. The effective disclosure stays `PERMISSION_REQUIRED` until a **human confirms** the row — an AI proposal alone never enables naming. |
| **Least labor** | An AI pass proposes a classification + rationale per record. Kateryna + Michael review a **pre-filled batch table** (not a blank one), bulk-confirm with per-row override, in one sitting. |
| **Done when** | (1) an `ANONYMIZED_ONLY` project can be selected & matched but its client name cannot reach a document; (2) `DO_NOT_USE` never appears in match results; (3) a project with `disclosure: NAMEABLE` but not yet human-confirmed is still redacted. |

### Design decisions (confirmed with reviewers)

1. **Redaction scope** — for any non-`NAMEABLE` project reaching generation, redact **client name + `clientPOC` + `contractNumber`** (a contract number is often as identifying as the name). **Plus free-text scrubbing (added 2026-08-18):** the client name (and POC name/organization) is frequently embedded in `description` / `technicalApproach` / `achievements` (e.g. *"enabled DegreeData to automate…"*), which the LLM reads verbatim — scrubbing only the structured `client` field misses these. `redactForGeneration` now also strips those names from the free-text fields (case-insensitive, word-boundary-bounded, ≥3 chars to avoid mangling substrings). This was a real leak: a confirmed `ANONYMIZED_ONLY` project still surfaced its name in generated Q&A / docs because the name lived in the description.

   **Defense-in-depth prompt layer (added 2026-08-18):** the deterministic scrub is the primary control, but it can't stop the model *reconstructing* a name from context (alias/brand knowledge). So two prompt-level backstops were added:
   - **Layer A (per-project):** `anonymizationNotice()` emits a `⚠️ CONFIDENTIAL CLIENT: do not name…` line attached to each non-`NAMEABLE` project block, on every surface that feeds a project to an LLM (answer-tools, document-tools, brief-tools, document-context ×2, generate-narrative).
   - **Layer B (global):** a `CLIENT_CONFIDENTIALITY_RULE` constant appended to every generation system prompt — document (full + section builders), narrative, and the answer system prompt (appended in `getAnswerSystemPrompt` even over org-overridden prompts, so a custom prompt can't drop it).
2. **Review UX** — a dedicated batch table, AI-prefilled, bulk-confirm + per-row override.
3. **Classification trigger** — on-demand backfill for the existing library via the review page's "Classify all". (Auto-propose-on-create was planned but removed — see §6; it was unreliable in Lambda and redundant with on-demand backfill.) Proposals stay unconfirmed (fail-closed) until review.

> **No silent 50-project cap (2026-08-17):** `classifyDisclosure`'s "all" branch now drains every page via `listAllPastProjects` (loops on `nextToken`), not the default 50-row `listPastProjects` page — otherwise "Classify all" would silently propose for only the first 50 and read as "done everything". The review table fetches a full page (`limit: 100`, the backend max) and shows an amber banner when `hasMore` (org exceeds one page); unshown rows stay fail-closed/redacted. `confirm-disclosure` still caps at 200 rows/request, so very large orgs must be reviewed in batches.

---

## 2. Architecture Overview <!-- ✅ IMPLEMENTED -->

The core principle is **one choke point, not per-surface patches**. The `client` field currently reaches an LLM or the browser through **eight** paths. Rather than edit each string interpolation, we route every generation/matching path through a single disclosure gate helper.

```
                         ┌─────────────────────────────────────┐
   AI classify pass ───► │  PastProject (DynamoDB, single-table)│
   (Sonnet, proposes)    │  disclosure / disclosureConfirmed    │
                         │  disclosureProposed* (AI, separate)  │
                         └───────────────┬─────────────────────┘
                                         │
   human batch review ──► confirm ──► disclosure + disclosureConfirmed=true
                                         │
                    ┌────────────────────┴─────────────────────┐
                    ▼                                           ▼
      ┌───────────────────────────┐              ┌───────────────────────────┐
      │  DISCLOSURE GATE (new)    │              │  Display surfaces          │
      │  past-performance-        │              │  warn if !NAMEABLE, but    │
      │  disclosure.ts            │              │  still show real name to   │
      │                           │              │  internal reviewers        │
      │  getEffectiveDisclosure() │              └───────────────────────────┘
      │  isUsableInMatching()     │
      │  redactForGeneration()    │
      └───────────┬───────────────┘
                  │  applied at every generation/matching surface
   ┌──────────────┼───────────────┬──────────────┬────────────────┐
   ▼              ▼               ▼              ▼                ▼
 matching     doc-tools       brief-tools    narrative      semantic-search
 (filter+     context         context        prompt         API response
  redact)     (redact)        (redact)       (redact)       (redact)
```

| Decision | Choice | Rationale |
|---|---|---|
| Where the classification is stored | On `PastProjectSchema` (core) | `disclosure` flows through `PastProjectMatch` → persisted brief automatically; one field, everywhere. |
| Effective vs proposed | Two separate field groups | Fail-closed: the AI writes only `disclosureProposed*`; `disclosure`/`disclosureConfirmed` change only on human action. |
| Existing-record migration | **None** — `.default('PERMISSION_REQUIRED')` + `disclosureConfirmed:.default(false)` | The gate treats missing/unconfirmed as the safe default, so every legacy record is redacted on day one. |
| Redaction vs deletion | Redact in a pure function at read time | Keeps the real name in DynamoDB for internal review; only the generation-bound copy is scrubbed. |
| Pinecone `client` metadata | Stop indexing it; re-read DynamoDB for authority | One path trusts stale vector metadata for `client`; that can't be the authority for a live disclosure flag. |
| Classification model | Fast active model `us.anthropic.claude-sonnet-4-6` (route override) via `bedrock-http-client` | Classification is cheap/high-volume, so it uses a fast model, not the stack-wide Opus default. **Must be an ACTIVE id the Bedrock API key can invoke** — Legacy/EOL ids (e.g. `claude-3-haiku-20240307`) return `ResourceNotFoundException`. Confirmed entitlement by matching the AnswerGen step function's model. |
| Sync latency / gateway cap | Batches run **concurrently but bounded** (`mapWithConcurrency`, max 4 in flight), Lambda `timeoutSeconds: 29` | API Gateway HTTP API caps the integration at **30s**; serial Opus calls hit 50s → **503** while the Lambda ran on. Fully-unbounded `Promise.all` fans `ceil(N/5)` Bedrock calls out at once → throttling on large orgs. Bounded parallelism (5/batch × 4 concurrent = 20 in flight) keeps typical orgs fast and large orgs from failing en masse. For very large libraries, move to an async 202 + worker + polling pattern. |

---

## 3. Data Models & Zod Schemas <!-- ✅ IMPLEMENTED -->

**File:** `packages/core/src/schemas/past-performance.ts` (extend existing).

### 3.1 New disclosure enum + constant list

```typescript
// ================================
// Disclosure classification (NDA / permission gating)
// ================================

export const DisclosureLevelSchema = z.enum([
  'NAMEABLE',            // client may be named freely in generated output
  'ANONYMIZED_ONLY',     // may be used, but client name must be withheld
  'PERMISSION_REQUIRED', // fail-closed default; treat as anonymized until cleared
  'DO_NOT_USE',          // never surface in matching or generation
]);
export type DisclosureLevel = z.infer<typeof DisclosureLevelSchema>;

/** Order used to render badge severity and to sort the review table. */
export const DISCLOSURE_ORDER: Record<DisclosureLevel, number> = {
  NAMEABLE: 0,
  ANONYMIZED_ONLY: 1,
  PERMISSION_REQUIRED: 2,
  DO_NOT_USE: 3,
} as const;
```

### 3.2 New fields on `PastProjectSchema`

Add this block inside `PastProjectSchema` (after the freshness fields, before `// Metadata`):

```typescript
  // ── Disclosure / NDA gating ──────────────────────────────
  // Effective (authoritative) classification. Fail-closed default.
  disclosure: DisclosureLevelSchema.default('PERMISSION_REQUIRED'),
  // Effective value is only trusted once a human confirms the row.
  disclosureConfirmed: z.boolean().default(false),
  disclosureContactNote: z.string().max(1000).nullable().optional(),
  disclosureReviewedBy: z.string().uuid().nullable().optional(),
  disclosureReviewedAt: z.string().datetime().nullable().optional(),

  // AI proposal — kept SEPARATE from the effective value above.
  disclosureProposed: DisclosureLevelSchema.nullable().optional(),
  disclosureRationale: z.string().max(2000).nullable().optional(),
  disclosureSignals: z.array(z.string()).default([]),
  disclosureConfidence: z.number().min(0).max(100).nullable().optional(),
  disclosureClassifiedAt: z.string().datetime().nullable().optional(),
```

> Because these live on `PastProjectSchema`, they automatically appear on `PastProjectMatchSchema.project`, the persisted `PastPerformanceSection`, and `PastProjectDraftSchema` (which extends `PastProjectSchema`). No extra schema plumbing.

### 3.3 DTO updates

`CreatePastProjectDTOSchema` — allow the manual form to set an initial disclosure (still unconfirmed unless explicitly confirmed via review):

```typescript
  disclosure: DisclosureLevelSchema.optional(),
  disclosureContactNote: z.string().max(1000).optional(),
```

`UpdatePastProjectDTOSchema` — allow editing the note + disclosure:

```typescript
  disclosure: DisclosureLevelSchema.optional(),
  disclosureContactNote: z.string().max(1000).optional().nullable(),
```

> **Do NOT** add `disclosureConfirmed` to the generic update DTO. Confirmation happens only through the dedicated review endpoint (§7.3), so a stray project edit can never flip a row to "trusted."

### 3.4 New request/response schemas (append to the DTO section)

```typescript
// ── AI classification (backfill) ──
export const ClassifyDisclosureRequestSchema = z.object({
  orgId: z.string().uuid(),
  projectIds: z.array(z.string().uuid()).optional(), // omit → classify all not-yet-proposed
  force: z.boolean().optional().default(false),      // re-propose even if already classified
});
export type ClassifyDisclosureRequest = z.infer<typeof ClassifyDisclosureRequestSchema>;

export const DisclosureProposalSchema = z.object({
  projectId: z.string().uuid(),
  proposed: DisclosureLevelSchema,
  rationale: z.string(),
  signals: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(100),
});
export type DisclosureProposal = z.infer<typeof DisclosureProposalSchema>;

export const ClassifyDisclosureResponseSchema = z.object({
  proposals: z.array(DisclosureProposalSchema),
  classified: z.number().int().nonnegative(),
  failed: z.array(z.string()).default([]),
});
export type ClassifyDisclosureResponse = z.infer<typeof ClassifyDisclosureResponseSchema>;

// ── Human review (confirm/override, batch) ──
export const ConfirmDisclosureRowSchema = z.object({
  projectId: z.string().uuid(),
  disclosure: DisclosureLevelSchema,
  disclosureContactNote: z.string().max(1000).optional().nullable(),
});
export type ConfirmDisclosureRow = z.infer<typeof ConfirmDisclosureRowSchema>;

export const ConfirmDisclosureRequestSchema = z.object({
  orgId: z.string().uuid(),
  rows: z.array(ConfirmDisclosureRowSchema).min(1).max(200),
});
export type ConfirmDisclosureRequest = z.infer<typeof ConfirmDisclosureRequestSchema>;
```

### 3.5 The AI output schema (used by the classifier helper)

```typescript
// Model output contract for the classification pass (one object per project).
export const ExtractedDisclosureSchema = z.object({
  proposed: DisclosureLevelSchema,
  rationale: z.string().min(1),
  signals: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(100),
});
export type ExtractedDisclosure = z.infer<typeof ExtractedDisclosureSchema>;
```

**Barrel:** already re-exported via `export * from './past-performance'` in `packages/core/src/schemas/index.ts` — no change needed.

**Verify:** `cd packages/core && pnpm build` (dependent packages import the built output).

---

## 4. The Disclosure Gate <!-- ✅ IMPLEMENTED -->

**File (new):** `apps/functions/src/helpers/past-performance-disclosure.ts`

This is the single choke point. Pure functions, no I/O, fully unit-testable.

```typescript
import type { DisclosureLevel, PastProject } from '@auto-rfp/core';

/**
 * Authoritative disclosure for gating decisions. Fail-closed:
 *  - unconfirmed rows are treated as PERMISSION_REQUIRED regardless of stored value
 *  - a missing value is PERMISSION_REQUIRED
 * An AI proposal alone never relaxes gating — only a human-confirmed row does.
 */
export const getEffectiveDisclosure = (
  project: Pick<PastProject, 'disclosure' | 'disclosureConfirmed'>,
): DisclosureLevel => {
  if (!project.disclosureConfirmed) return 'PERMISSION_REQUIRED';
  return project.disclosure ?? 'PERMISSION_REQUIRED';
};

/** DO_NOT_USE projects are excluded from matching entirely. */
export const isUsableInMatching = (
  project: Pick<PastProject, 'disclosure' | 'disclosureConfirmed'>,
): boolean => getEffectiveDisclosure(project) !== 'DO_NOT_USE';

/** Only NAMEABLE projects may surface the real client name. */
export const isNameable = (
  project: Pick<PastProject, 'disclosure' | 'disclosureConfirmed'>,
): boolean => getEffectiveDisclosure(project) === 'NAMEABLE';

/**
 * In-band instruction to attach to a non-NAMEABLE project block so the LLM is
 * told not to *reconstruct* the client name. Empty string for NAMEABLE.
 */
export const anonymizationNotice = (
  project: Pick<PastProject, 'disclosure' | 'disclosureConfirmed'>,
): string =>
  isNameable(project)
    ? ''
    : '⚠️ CONFIDENTIAL CLIENT: Do NOT name this client in the output. …';

const anonymizedClientLabel = (project: Pick<PastProject, 'domain'>): string =>
  project.domain
    ? `[Client name withheld — ${project.domain} engagement]`
    : '[Client name withheld]';

/**
 * Return a copy safe to feed into any generation path. For non-NAMEABLE
 * projects the client name, client POC, and contract number are scrubbed — AND
 * the client name (plus POC name/organization) is stripped from the free-text
 * fields an LLM reads verbatim (`title`, `description`, `technicalApproach`,
 * `achievements`), since the name is frequently embedded there (e.g.
 * "enabled DegreeData to automate…"). Scrubbing is case-insensitive,
 * word-boundary-bounded, and skips names <3 chars. If scrubbing empties the
 * (client-derived) title, it falls back to a `[Confidential project]`
 * placeholder. DO_NOT_USE should already be filtered out before this point;
 * if it slips through we still redact (defense in depth).
 */
export const redactForGeneration = <T extends PastProject>(project: T): T => {
  if (isNameable(project)) return project;
  const names = [project.client, project.clientPOC?.name, project.clientPOC?.organization]
    .filter((n): n is string => !!n && n.trim().length > 0);
  return {
    ...project,
    title: /* scrubbed, or '[Confidential project]' if emptied */ project.title,
    client: anonymizedClientLabel(project),
    clientPOC: null,
    contractNumber: null,
    description: scrubNames(project.description, names) ?? project.description,
    technicalApproach: scrubNames(project.technicalApproach, names),
    achievements: (project.achievements ?? []).map((a) => scrubNames(a, names) as string),
  };
};
```

> The snippet above is illustrative — see the shipped file for the exact `scrubNames` / title-fallback implementation.

**Tests:** `apps/functions/src/helpers/past-performance-disclosure.test.ts`
- `getEffectiveDisclosure`: confirmed NAMEABLE → NAMEABLE; NAMEABLE **but not confirmed** → PERMISSION_REQUIRED; undefined → PERMISSION_REQUIRED; confirmed DO_NOT_USE → DO_NOT_USE.
- `isUsableInMatching`: false only for effective DO_NOT_USE (incl. confirmed).
- `redactForGeneration`: NAMEABLE passes through untouched; ANONYMIZED_ONLY / PERMISSION_REQUIRED scrub client+POC+contractNumber; label uses domain when present; the client name is also stripped from `title` / `description` / `technicalApproach` / `achievements`, with a `[Confidential project]` fallback when the title was entirely the client name.
- `anonymizationNotice`: empty for confirmed NAMEABLE; a `⚠️ CONFIDENTIAL CLIENT` instruction otherwise.

**Verify:** `cd apps/functions && pnpm build`

---

## 5. Apply the Gate — All Eleven Leak Surfaces <!-- ✅ IMPLEMENTED -->

Each surface below currently emits `client` (or the full project) to an LLM or the browser. Reference lines are current as of this branch.

> **Correction:** the original design said "eight surfaces"; a later review found three more (#9–#11). Surface #9 (`answer-tools.ts`) is the most serious — it feeds an LLM during answer generation and, like #5, never self-heals from Pinecone, so it required re-reading DynamoDB.

| # | File · line | Change |
|---|---|---|
| 1 | `helpers/past-performance.ts` — `matchProjectsToRequirements` (~L419, ~L452) | After loading each `project`, `continue` when `!isUsableInMatching(project)`; push `redactForGeneration(project)` into the match (both the semantic branch and the fallback-all branch). |
| 2 | `helpers/past-performance.ts` — `indexPastProjectToPinecone` (~L313) | Remove `client` from the Pinecone `metadata` object. (Leave it out of the embedding text too, L292, so vector recall doesn't key on a name we may not use.) |
| 3 | `helpers/document-tools.ts` — `executePastPerformanceSearch` (~L238-244) | Wrap loaded project with the gate: skip if not usable; use `redactForGeneration(project).client` for the `Client:` line. |
| 4 | `helpers/brief-tools.ts` — `executePastPerformanceSearch` (~L197-203) | Same as #3. |
| 5 | `helpers/document-context.ts` — `loadPastPerformanceContext` (~L398-427) | **Do not trust Pinecone `metadata.client`.** For each hit, `getPastProject` to get the authoritative record, drop if `!isUsableInMatching`, and emit `redactForGeneration(project).client`. Apply the same redaction in the list-all fallback branch (L417-427). |
| 6 | `helpers/document-context.ts` — `loadExecutiveBriefContext` (~L324-346) | The persisted brief already carries redacted matches (from #1), but defense-in-depth: only emit `proj.client` when the match's `project.disclosure`/`disclosureConfirmed` is effectively NAMEABLE; otherwise print the withheld label. |
| 7 | `handlers/pastperf/generate-narrative.ts` — `generateProjectNarrative` (~L198-216) | Before building the prompt: if `!isUsableInMatching(project)` return early (skip / 409). Feed `redactForGeneration(project)` into the template so `{{PROJECT_CLIENT}}` and `{{CONTRACT_NUMBER}}` are the withheld label / `N/A`. Also change the batch loop (~L160) to skip `DO_NOT_USE`. |
| 8 | `handlers/semanticsearch/search.ts` — past-performance result build (~L160-177) | Drop the project if `!isUsableInMatching`; set `client` from `redactForGeneration(project).client`. This response feeds Q&A/answer generation, so it is a generation-adjacent leak, not just display. |
| 9 | `helpers/answer-tools.ts` — `executePastPerfSearch` (~L276) | **Highest risk — feeds an LLM during answer generation.** Emitted `Client: ${m.client}` straight from Pinecone metadata; never re-read DynamoDB, so it wouldn't self-heal after reindex (would just go blank). Fixed to `getPastProject` per hit, drop `!isUsableInMatching`, emit `redactForGeneration(project).client`. |
| 10 | `handlers/opportunity-context/get-opportunity-context.ts` — `searchPastPerformance` (~L123) | Auto-suggested context items are **persisted and feed the opportunity assistant (RAG)**. Semantic branch read `metadata.client` from Pinecone; fallback branch listed all projects ungated. Both branches now re-read DynamoDB (semantic) / gate + redact (fallback). |
| 11 | `handlers/brief/export-brief-docx.ts` — top-matches table (~L389) | Exports a `.docx`. New briefs carry redacted matches (from #1), but briefs persisted pre-deploy hold unredacted matches. Defense-in-depth: emit the real client only when the match is effectively `NAMEABLE` (`isNameable`), else a withheld label. |

> **Reindex note:** removing `client` from Pinecone metadata (#2) means existing vectors keep stale metadata until re-indexed. `loadPastPerformanceContext` (#5) no longer reads that metadata, so this is safe, but schedule a `reindex-projects` run after deploy to clean vectors.

**Tests to add/update:**
- `past-performance-matching.test.ts` — a `DO_NOT_USE` project never appears in `topMatches`; an `ANONYMIZED_ONLY` match has `client` redacted in the persisted section.
- New: `document-context` / `document-tools` redaction tests (mock `getPastProject`).
- `generate-narrative` — `DO_NOT_USE` short-circuits; `ANONYMIZED_ONLY` prompt contains the withheld label, never the real client.

**Verify:** `cd apps/functions && pnpm build && pnpm test -- --testPathPattern=past-performance`

---

## 6. AI Classification Pass <!-- ✅ IMPLEMENTED -->

Reuses the existing extraction pattern (`extraction-processor.ts`): a fast active model (Sonnet, pinned via the route's `extraEnv`) invoked through `bedrock-http-client`, `parseJsonFromResponse` (extracted to the shared `@/helpers/ai-json` module), Zod validation.

### 6.1 Prompt constants

**File (new):** `apps/functions/src/constants/disclosure-prompts.ts`

```typescript
export const DISCLOSURE_CLASSIFY_SYSTEM_PROMPT = `You classify whether a past-performance project's CLIENT may be named in a government proposal.

Return ONLY a JSON array, one object per project, each:
{
  "projectId": "string",
  "proposed": "NAMEABLE" | "ANONYMIZED_ONLY" | "PERMISSION_REQUIRED" | "DO_NOT_USE",
  "rationale": "one or two sentences citing the signals",
  "signals": ["short signal strings"],
  "confidence": 0-100
}

CLASSIFICATION GUIDANCE (fail-closed — when unsure, choose PERMISSION_REQUIRED):
- NAMEABLE: the client is already named publicly by us (public case study / press release provided), OR context clearly states naming is permitted.
- ANONYMIZED_ONLY: the work can be described but the client asked not to be named, or only anonymized references are allowed.
- PERMISSION_REQUIRED: default. No evidence either way, or ambiguous.
- DO_NOT_USE: an NDA or contract clause forbids referencing the engagement at all, or the client is on the known-blocked list.

Never output NAMEABLE unless there is explicit positive evidence.`;

export const createDisclosureClassifyUserPrompt = (payload: string): string =>
  `Classify the following projects. For each, weigh: NDA mentions in the provided knowledge-base/contract excerpts, whether the client already appears in public case studies (→ probably NAMEABLE), and the known-blocked client list.

${payload}

Return the JSON array only. First char "[", last char "]".`;
```

### 6.2 Classifier helper

**File (new):** `apps/functions/src/helpers/disclosure-classifier.ts`

```typescript
import { invokeModel } from '@/helpers/bedrock-http-client';
import { requireEnv } from '@/helpers/env';
import { listAllPastProjects, getPastProject } from '@/helpers/past-performance';
import { queryCompanyKnowledgeBase } from '@/helpers/executive-opportunity-brief'; // NDA-signal source
import { loadTextFromS3 } from '@/helpers/s3';
import { parseJsonFromResponse } from '@/helpers/ai-json';
import { ExtractedDisclosureSchema, type DisclosureProposal, type PastProject } from '@auto-rfp/core';

// Fast model for cheap/high-volume classification, pinned by the route's extraEnv.
// NO literal fallback: if a Lambda imports this helper without BEDROCK_MODEL_ID
// set, fail loud at load time rather than silently invoking a wrong/legacy model.
// (See the bedrock-model-id-pinning note — never hard-code a model id as a default.)
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');

const CLASSIFY_BATCH_SIZE = 5;
// Max batches (each = one Bedrock call + KB query + S3 reads) in flight at once,
// so a large/forced reclassify can't fan ceil(N/5) simultaneous Bedrock calls out
// and trip throttling / the 30s gateway ceiling.
const CLASSIFY_MAX_CONCURRENCY = 4;

/** Known-blocked client names, org-configurable later; env-seeded for v1. */
const knownBlockedClients = (): string[] =>
  (process.env.DISCLOSURE_BLOCKED_CLIENTS ?? '').split(',').map(s => s.trim()).filter(Boolean);

const buildPayloadForProject = async (orgId: string, p: PastProject): Promise<string> => {
  // Pull NDA / permission signal TEXT from the KB (resolve chunk keys via S3).
  const kbText = await loadKbSignals(orgId, p.client); // queryCompanyKnowledgeBase + loadTextFromS3
  const blocked = knownBlockedClients();
  return [
    `--- projectId: ${p.projectId} ---`,
    `Client: ${p.client}`,
    `Title: ${p.title}`,
    `Domain: ${p.domain ?? 'N/A'}`,
    p.contractNumber ? `Contract: ${p.contractNumber}` : '',
    `KnownBlockedListHit: ${blocked.some(b => p.client.toLowerCase().includes(b.toLowerCase()))}`,
    kbText ? `KB/contract signals:\n${kbText}` : 'KB/contract signals: none found',
  ].filter(Boolean).join('\n');
};

export const classifyDisclosure = async (
  orgId: string,
  projectIds?: string[],
  force = false,
): Promise<{ proposals: DisclosureProposal[]; classified: number; failed: string[] }> => {
  // Resolve target projects. The "all" branch drains EVERY page via
  // listAllPastProjects (loops on nextToken) — the default listPastProjects page
  // is 50 rows and would silently classify only the first 50.
  const projects: PastProject[] = projectIds?.length
    ? (await Promise.all(projectIds.map(id => getPastProject(orgId, id)))).filter((p): p is PastProject => !!p)
    : await listAllPastProjects(orgId);

  const targets = projects.filter(p => force || !p.disclosureProposed);

  // Batches run concurrently but BOUNDED (mapWithConcurrency, ≤4 in flight);
  // classifyBatch never throws — it routes failures into `failed`.
  const batchResults = await mapWithConcurrency(
    chunk(targets, CLASSIFY_BATCH_SIZE),
    CLASSIFY_MAX_CONCURRENCY,
    (batch) => classifyBatch(orgId, batch),
  );
  const proposals = batchResults.flatMap(r => r.proposals);
  const failed = batchResults.flatMap(r => r.failed);
  return { proposals, classified: proposals.length, failed };
};
```

> The snippet is illustrative — see the shipped file for `mapWithConcurrency`, `classifyBatch`, and `loadKbSignals`.

**Persisting proposals** — a helper on `past-performance.ts` that writes **only** the `disclosureProposed*` fields (never `disclosure`/`disclosureConfirmed`):

```typescript
export async function saveDisclosureProposal(orgId: string, p: DisclosureProposal): Promise<boolean> {
  // UpdateCommand SET disclosureProposed, disclosureRationale, disclosureSignals,
  //   disclosureConfidence, disclosureClassifiedAt = now, updatedAt = now
  // Guarded by ConditionExpression attribute_exists(#pk). p.projectId is LLM-echoed
  // and may be hallucinated / wrong-org — swallow ConditionalCheckFailedException
  // and return false (skip) rather than reject; rethrow other errors. Returns
  // true when a row was updated. Mirrors confirmDisclosureRows.
}
```

**Batch resilience (2026-08-17):** the classify handler persists proposals with `Promise.allSettled` (not `Promise.all`), and folds both skipped rows (`saveDisclosureProposal` → false) and transient write failures into the response's `failed` list, decrementing `classified`. So one bad/hallucinated `projectId` from the model can no longer 500 the whole batch and discard every valid proposal alongside it.

**Auto-propose on create — REMOVED (2026-08-17).** The original plan fired `classifyDisclosure(orgId, [projectId])` best-effort at the end of `createPastProject`. This was implemented as a fire-and-forget `void import().then()` after the response was built — which is **unreliable in Lambda**: work not awaited before the handler returns is frozen and usually never runs. Awaiting it instead would add a KB query + Bedrock call to every create/draft-confirm. Since new rows are fail-closed (`disclosureConfirmed: false`) and the review page's **"Classify all"** reliably proposes for any unproposed row on demand, the create-path auto-propose was dropped entirely rather than made reliable. `classifyDisclosure` is unchanged; only the create hook and the now-unused `autoProposeDisclosure` helper were removed.

**Tests:** `disclosure-classifier.test.ts` — mock `invokeModel`; assert malformed rows land in `failed`, valid rows produce proposals, `force=false` skips already-proposed projects, blocked-list hit is passed in the payload.

---

## 7. Backend Handlers <!-- ✅ IMPLEMENTED -->

```
apps/functions/src/handlers/pastperf/
├── classify-disclosure.ts   (new) — POST, triggers the AI backfill pass
└── confirm-disclosure.ts    (new) — POST, batch human confirm/override
```

### 7.1 `classify-disclosure.ts`

Thin handler: destructure `ClassifyDisclosureRequestSchema.safeParse`, `orgId` from body, call `classifyDisclosure`, `saveDisclosureProposal` for each, return `ClassifyDisclosureResponse` via `apiResponse`. Middy stack + `withSentryLambda`. Permission: `kb:edit`. `timeoutSeconds: 29` (under the 30s API Gateway ceiling), `memorySize: 1024`. Batches (5 projects each) run with **bounded concurrency** in `classifyDisclosure` — `CLASSIFY_MAX_CONCURRENCY = 4` in-flight batches, so a large/forced reclassify can't fan out `ceil(N/5)` simultaneous Bedrock calls.

### 7.2 Guard-clause skeleton (classify)

```typescript
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  let raw: unknown;
  try {
    raw = JSON.parse(event.body || '{}');
  } catch {
    return apiResponse(400, { message: 'Invalid JSON in request body' });
  }

  const { success, data, error } = ClassifyDisclosureRequestSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const { proposals, classified, failed } = await classifyDisclosure(data.orgId, data.projectIds, data.force);

  // Persist with Promise.allSettled (not Promise.all): one write failure can't
  // discard the other valid proposals. Fold skipped rows (saveDisclosureProposal
  // → false) and transient write failures into `failed`, decrementing `classified`.
  const persisted = await Promise.allSettled(
    proposals.map(p => saveDisclosureProposal(data.orgId, p)),
  );
  const persistFailed = proposals
    .filter((_, i) => persisted[i].status === 'rejected' || persisted[i].value === false)
    .map(p => p.projectId);

  return apiResponse(200, {
    proposals,
    classified: classified - persistFailed.length,
    failed: [...failed, ...persistFailed],
  });
};
```

### 7.3 `confirm-disclosure.ts` (the only path that flips `disclosureConfirmed`)

```typescript
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = ConfirmDisclosureRequestSchema.safeParse(JSON.parse(event.body || '{}'));
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const userId = event.auth?.userId ?? 'system';
  const now = nowIso();
  const updated = await confirmDisclosureRows(data.orgId, data.rows, userId, now); // sets disclosure,
  //   disclosureConfirmed=true, disclosureContactNote, disclosureReviewedBy/At per row

  setAuditContext(event, { action: 'PAST_PERF_DISCLOSURE_CONFIRMED', resource: 'past_project', resourceId: data.orgId });
  return apiResponse(200, { confirmed: updated });
};
```

Handler rules enforced: no raw DynamoDB SDK (all via `past-performance.ts` helpers), `orgId` from body, destructured `safeParse`, guarded `JSON.parse` → 400 on malformed body, `apiResponse` everywhere, `auditMiddleware` on `confirm-disclosure` (it's a governance action).

**RBAC:** both handlers enforce `kb:edit` via the full stack `authContextMiddleware → orgMembershipMiddleware → requirePermission('kb:edit') → [auditMiddleware on confirm] → httpErrorMiddleware`. `requirePermission` reads `event.rbac`, which only `orgMembershipMiddleware` populates — so both must be present, in that order. (Note: sibling pastperf *read* handlers like gap-analysis/generate-narrative use only `authContextMiddleware`; these two are guarded because they write AI proposals + bill Bedrock, and confirm flips the fail-closed flag.)

**Tests:** happy path, validation 400, not-found rows skipped, confirm sets `disclosureConfirmed=true` + reviewer stamp, classify persists only proposal fields.

---

## 8. REST API Routes <!-- ✅ IMPLEMENTED -->

**File:** `packages/infra/api/routes/pastperf.routes.ts` — add to the `routes` array:

```typescript
      // Disclosure classification & review
      {
        method: 'POST',
        path: 'classify-disclosure',
        entry: lambdaEntry('pastperf/classify-disclosure.ts'),
        timeoutSeconds: 29, // under the 30s API Gateway HTTP API ceiling
        memorySize: 1024,
        // Fast active model for cheap/high-volume classification. Must be an id
        // the Bedrock API key can invoke (NOT a Legacy/EOL id).
        extraEnv: { BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6' },
      },
      {
        method: 'POST',
        path: 'confirm-disclosure',
        entry: lambdaEntry('pastperf/confirm-disclosure.ts'),
      },
```

The `pastperf` domain is already registered in `api-orchestrator-stack.ts` — no orchestrator change. Every new Lambda gets its CloudWatch Log Group via the existing per-route wiring (2-week retention non-prod / retained prod).

| Method | Path | Body | Permission | Purpose |
|---|---|---|---|---|
| POST | `/pastperf/classify-disclosure` | `ClassifyDisclosureRequest` | `kb:edit` | AI backfill — writes proposals only |
| POST | `/pastperf/confirm-disclosure` | `ConfirmDisclosureRequest` | `kb:edit` | Batch human confirm/override |

---

## 9. Frontend — Review Table & Warnings <!-- ✅ IMPLEMENTED -->

### 9.1 Batch review table

```
apps/web/features/disclosure-review/
├── hooks/
│   ├── useClassifyDisclosure.ts   // POST classify (SWR mutation), revalidates project list
│   └── useConfirmDisclosure.ts    // POST confirm (batch)
├── components/
│   ├── DisclosureReviewTable.tsx  // one row/project: real client + proposed Select + rationale/confidence/signals
│   └── DisclosureBadge.tsx        // shared badge for non-NAMEABLE
└── index.ts
```

`DisclosureReviewTable` (client component): SWR-fetches the org's projects, renders one row each — title, **real client** (visible to internal reviewers), a `Select` pre-set to `disclosureProposed ?? disclosure`, rationale + confidence + signal chips, and an editable contact note. Header actions: **"Classify all"** (calls `useClassifyDisclosure`, shows skeleton rows while pending) and **"Confirm all as proposed"** + per-row override, submitting one `ConfirmDisclosureRequest`. Loading = `<Skeleton>` rows, never spinners. Types from `@auto-rfp/core`.

Page: `apps/web/app/organizations/[orgId]/past-performance/disclosure/page.tsx`, linked from the past-performance list header.

### 9.2 `DisclosureBadge`

```tsx
const LABELS: Record<DisclosureLevel, { text: string; variant: 'secondary' | 'destructive' | 'outline' }> = {
  NAMEABLE:            { text: 'Nameable',            variant: 'outline' },
  ANONYMIZED_ONLY:     { text: 'Anonymize',           variant: 'secondary' },
  PERMISSION_REQUIRED: { text: 'Permission required', variant: 'secondary' },
  DO_NOT_USE:          { text: 'Do not use',          variant: 'destructive' },
};
// Render nothing for NAMEABLE (no warning needed); a Badge otherwise.
```

### 9.3 Warnings on existing display surfaces

| Component · line | Change |
|---|---|
| `components/brief/components/PastPerformanceCard.tsx` — `ProjectMatchRow` (~L135, near the score `Badge` L155) | Render `<DisclosureBadge level={getEffectiveDisclosure(project)} />` next to the client name. |
| `components/past-performance/PastProjectsContent.tsx` — `renderProjectItem` (~L135) | Same badge in the card meta row. |
| `components/past-performance/PastProjectForm.tsx` (~L49 schema, form body) | Add a `disclosure` `Select` + `disclosureContactNote` textarea (initial value defaults to `PERMISSION_REQUIRED`). |

> Display surfaces still show the **real** client name to internal reviewers — redaction happens only on the generation path. The badge is the "visible warning wherever a match is shown" required by the ticket.

**Tests:** `DisclosureBadge` renders nothing for NAMEABLE / a destructive badge for DO_NOT_USE; `DisclosureReviewTable` renders skeletons while loading, pre-selects the proposed value, and submits overrides.

**Verify:** `cd apps/web && npx tsc --noEmit`

---

## 10. Permissions & RBAC <!-- ✅ IMPLEMENTED -->

Both new endpoints reuse the existing `kb:edit` permission (same as draft confirm/discard) — no new permission needed. If reviewers should be a narrower set than KB editors, add `pastperf:disclosure` to `packages/core/src/schemas/user.ts` and gate `confirm-disclosure` on it; deferred unless requested.

**UI must match the API (2026-08-17):** the "Disclosure review" button on the past-performance list gates on `kb:edit` (not `project:edit`), and `DisclosureReviewTable` itself guards on `kb:edit` via `usePermission` — showing an access message and skipping the fetch for users without it. This prevents the mismatch where a `project:edit`-only user could open the page and 403 on every action. Any change to the endpoints' required permission must be mirrored in both the button and the table guard.

---

## 11. CDK / Infrastructure Summary <!-- ✅ IMPLEMENTED -->

| Resource | Change |
|---|---|
| `pastperf` API routes | +2 routes (§8) — Lambdas auto-provisioned with Log Groups by existing route wiring |
| DynamoDB | No table/GSI change — new attributes are schemaless additions to existing `PAST_PROJECT` items |
| Pinecone | Stop writing `client` metadata; run `reindex-projects` post-deploy to scrub existing vectors |
| IAM | None new — Bedrock (HTTP), DynamoDB, Pinecone already granted to the shared Lambda role |
| Env | `DISCLOSURE_BLOCKED_CLIENTS` (optional, comma-separated) on the classify Lambda |

Cost: classification is a fast Sonnet model, batched 5/call, run on-demand via "Classify all" — negligible. No new persistent infra.

---

## 12. Implementation Tickets <!-- ✅ IMPLEMENTED -->

### ND-1 · Core schema + build (30 min) <!-- ✅ IMPLEMENTED -->
`packages/core`: add `DisclosureLevelSchema`, the 10 fields on `PastProjectSchema`, DTO updates, request/response + `ExtractedDisclosureSchema`. Schema tests (defaults, fail-closed). `pnpm --filter @auto-rfp/core build`.

### ND-2 · Disclosure gate + tests (45 min) <!-- ✅ IMPLEMENTED -->
`helpers/past-performance-disclosure.ts` + unit tests. This is the highest-value, lowest-risk unit — land it first.

### ND-3 · Apply gate to all 8 leak surfaces (3 h) <!-- ✅ IMPLEMENTED -->
Edits per §5 table + matching/context/narrative/search tests. Remove Pinecone `client` metadata.

### ND-4 · AI classifier + prompts (2 h) <!-- ✅ IMPLEMENTED -->
`constants/disclosure-prompts.ts`, `helpers/disclosure-classifier.ts` (bounded-concurrency batches), `helpers/ai-json.ts`, `saveDisclosureProposal`. (Auto-propose-on-create was dropped — see §6.) Tests.

### ND-5 · Handlers + routes (1.5 h) <!-- ✅ IMPLEMENTED -->
`classify-disclosure.ts`, `confirm-disclosure.ts`, `confirmDisclosureRows` helper, route registration. Handler tests.

### ND-6 · Frontend review table + badges + form (3 h) <!-- ✅ IMPLEMENTED -->
`disclosure-review` feature, `DisclosureBadge`, warnings on the two cards, disclosure controls on the form, review page. Component tests.

### ND-7 · Integration verification + reindex (1 h) <!-- ✅ IMPLEMENTED -->
End-to-end: ANONYMIZED_ONLY matched but redacted in a generated doc; DO_NOT_USE absent from matches; unconfirmed-NAMEABLE still redacted. Deploy + run `reindex-projects`.

---

## 13. Acceptance Criteria Checklist <!-- ✅ IMPLEMENTED -->

- [ ] `disclosure` + note fields on `PastProjectSchema`, default `PERMISSION_REQUIRED`, `disclosureConfirmed` default `false`.
- [ ] Existing records require **no migration** and are treated as `PERMISSION_REQUIRED` (fail-closed) until reviewed.
- [ ] `DO_NOT_USE` never appears in match results (semantic **and** fallback-all branches).
- [ ] An `ANONYMIZED_ONLY` project can be selected & matched, but its client name never reaches a generated document, brief, narrative, or Q&A answer.
- [ ] A project with `disclosure: NAMEABLE` but `disclosureConfirmed: false` is still redacted.
- [ ] `clientPOC` and `contractNumber` are scrubbed for non-NAMEABLE projects on every generation path.
- [ ] Pinecone no longer stores/relies on `client` metadata for context building.
- [ ] AI pass proposes `disclosureProposed*` only — never mutates `disclosure`/`disclosureConfirmed`.
- [ ] Reviewers see a pre-filled batch table; bulk-confirm + per-row override in one save.
- [ ] A visible disclosure badge renders wherever a non-NAMEABLE match/project is shown.
- [ ] All eight surfaces covered by tests; `tsc --noEmit` clean in every package.

---

## 14. Summary of New Files <!-- ✅ IMPLEMENTED -->

| File | Purpose | Status |
|---|---|---|
| `packages/core/src/schemas/past-performance.ts` (edit) | Disclosure enum + fields + DTOs | ✅ |
| `apps/functions/src/helpers/past-performance-disclosure.ts` | The gate (effective/usable/redact) | ✅ |
| `apps/functions/src/helpers/past-performance-disclosure.test.ts` | Gate unit tests | ✅ |
| `apps/functions/src/constants/disclosure-prompts.ts` | Classifier prompts | ✅ |
| `apps/functions/src/helpers/disclosure-classifier.ts` | Sonnet classification pass (bounded concurrency) | ✅ |
| `apps/functions/src/helpers/ai-json.ts` | Shared `parseJsonFromResponse` for LLM output | ✅ |
| `apps/functions/src/helpers/disclosure-classifier.test.ts` | Classifier tests | ✅ |
| `apps/functions/src/handlers/pastperf/classify-disclosure.ts` | Backfill endpoint | ✅ |
| `apps/functions/src/handlers/pastperf/confirm-disclosure.ts` | Batch confirm endpoint | ✅ |
| `apps/functions/src/handlers/pastperf/*.test.ts` (2) | Handler tests | ✅ |
| `packages/infra/api/routes/pastperf.routes.ts` (edit) | +2 routes | ✅ |
| `apps/web/features/disclosure-review/**` | Review table, hooks, badge, barrel | ✅ |
| `apps/web/app/organizations/[orgId]/past-performance/disclosure/page.tsx` | Review page | ✅ |
| Edits: `past-performance.ts`, `document-tools.ts`, `document-context.ts`, `brief-tools.ts`, `generate-narrative.ts`, `semanticsearch/search.ts`, `PastPerformanceCard.tsx`, `PastProjectsContent.tsx`, `PastProjectForm.tsx` | Gate application + badges | ✅ |

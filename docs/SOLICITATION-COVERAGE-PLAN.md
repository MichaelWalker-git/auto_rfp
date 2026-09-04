# Full solicitation coverage for Solution Plan generation

## Context

Today, `loadSolicitation` (`apps/functions/src/helpers/document-generation.ts:38`) blindly slices merged solicitation text at 80 000 chars, and downstream `solution-plan-worker.ts:127-148` further trims to 60 000 for the Griller and 10 000 for the Tech Lead primer. With multiple documents (~145 KB raw on the Dev repro opportunity `f2e4b41c-…`), whole trailing documents disappear silently — the merge is sorted `createdAt DESC` (`executive-opportunity-brief.ts:537`), so the *oldest* files are the first to go, and duplicates (Dev has `WEBSMemo.pdf` twice) eat budget without contributing.

Users report *"all information in the solicitation documents is important"* — the current strategy is losing signal deterministically and invisibly. The intended outcome is that every RFP, regardless of total text size, reaches the Solution Plan agents with either full content or a lossless-by-design routing to it. Small/medium RFPs get the full text at low cost via prompt caching; huge RFPs get per-document summaries plus an on-demand fetch tool, so nothing is silently dropped.

Related but out of scope: the tool-loop reliability fixes (empty-content guard, transient 5xx retry, final-round salvage) — those live in `docs/SOLUTION-PLAN-FIX-PLAN.md` and land in a separate PR.

## Strategy — hybrid, decided at load time

Route on total merged raw text size, threshold defaulting to **150 000 chars** (env-tunable `SOLUTION_PLAN_FULL_SOLICITATION_THRESHOLD_CHARS`):

```
merged = loadAllSolicitationTexts(...)   // no truncation at load time

if merged.length <= THRESHOLD:
    strategy = 'FULL'         → send full text, prompt-cached, per-doc floor
else:
    strategy = 'SUMMARIZED'   → per-doc summaries + fetch_solicitation_section tool
```

Only Solution Plan uses the new routing; existing consumers of `loadSolicitation` (`edit-section.ts`, `team-matching.ts`) and `loadAllSolicitationTexts` (`answer-tools.ts`, `get-opportunity-context.ts`) keep the current `string`-returning signature.

## Layer 0 — per-document budget floor (kills silent drops even inside FULL)

**File:** `apps/functions/src/helpers/executive-opportunity-brief.ts` (`loadAllSolicitationTexts`, `:544-592`)

Replace the single `merged.slice(0, maxChars)` with a per-document allocation so no whole file disappears:

- Compute `perDocBudget = max(MIN_PER_DOC_CHARS, Math.floor(maxChars / files.length))` (with `MIN_PER_DOC_CHARS = 3_000`).
- Truncate each document to its share before merging.
- If the sum is still over `maxChars` (small `perDocBudget` × many files), do a final round-robin trim: drop 500 chars off the tail of the largest surviving document until it fits.
- Preserve existing document markers (`--- Document N: name ---`).
- Log which documents were trimmed and by how much (currently silent).

Reused by every existing consumer at their current cap. On the Dev repro (6 files × ~24 KB budget each after 145 KB → 80 KB target), the oldest RFP body no longer vanishes.

## Layer A — `FULL` path (default for RFPs ≤ threshold)

### 1. Raise the caps

**File:** `apps/functions/src/helpers/solution-plan-prompts.ts:45-49`

```ts
export const GRILLER_SOLICITATION_CHAR_CAP = 150_000;   // was 60_000
export const TECH_LEAD_PRIMER_CHAR_CAP     = 150_000;   // was 10_000
// GRILLER_BRIEF_CHAR_CAP unchanged (8_000)
```

**File:** `apps/functions/src/constants/document-generation.ts:6`

```ts
export const MAX_SOLICITATION_CHARS = Number(
  requireEnv('PROPOSAL_MAX_SOLICITATION_CHARS', '150000'),   // was 80000
);
```

Claude Sonnet 4.5 supports 200 k tokens (~600 k chars). 150 k chars for the solicitation leaves comfortable headroom for system prompt + exec brief + transcript + tool responses + output. Both caps become the same value because the FULL path deliberately gives both agents the same text — the "compact primer" design assumed detail came via tools, which is no longer true.

### 2. Prompt caching on the solicitation block

**Files:**
- `apps/functions/src/helpers/bedrock-tool-loop.ts` (request-body construction)
- `apps/functions/src/helpers/griller-agent.ts` (system/user assembly)
- `apps/functions/src/helpers/tech-lead-agent.ts` (system/user assembly)

Pass a `SolicitationBundle` through instead of the flat `solicitationText` string. When the bundle is `strategy: 'FULL'`, both agents place the solicitation body in a **separate** content block marked with `cache_control: { type: 'ephemeral' }`:

```ts
messages: [{
  role: 'user',
  content: [
    { type: 'text', text: instructions },
    { type: 'text', text: solicitationBlock, cache_control: { type: 'ephemeral' } },
  ],
}]
```

Anthropic prompt caching (5-minute TTL) makes rounds 2–4 and synthesis ~10× cheaper on the solicitation prefix and cuts round latency significantly. The bundle-not-string change is the smallest wedge that carries cache metadata through both agents cleanly.

## Layer B — `SUMMARIZED` path (RFPs > threshold)

### 1. Per-document summaries computed once, cached on the QuestionFile record

**Preferred:** compute at text-extraction time (existing pipeline in `apps/functions/src/handlers/question-file/` / `question-pipeline-step-function`), store as `summary` and `sections` on the `QuestionFileItem`. Zero incremental latency on the Solution Plan run.

**Fallback if the extraction-time hook is out of scope for this PR:** compute lazily on the first grilling round if a summary is missing.

- Model: `SOLUTION_PLAN_GRILLER_MODEL_ID` if set, else the shared model (usually Haiku — cheap and fast).
- `max_tokens`: 800 per summary.
- Content: 3–5 sentences on the document's purpose + a bulleted list of section headings (from the extracted text, one Bedrock call per file).
- Parallel across files (`Promise.all`, no concurrency limit needed at ~6 files).

New helper: `summarizeSolicitationDocument(orgId, file, text): Promise<DocSummary>` in `apps/functions/src/helpers/solicitation-summary.ts`.

### 2. Primer becomes a document manifest

In `SUMMARIZED` mode, `buildOpportunityPrimer` (`solution-plan-worker.ts:119-125`) produces:

```
DOCUMENT MANIFEST (5 documents, 285 000 chars total):

--- Document 1: RFP 2026-110 Main.pdf (145 000 chars) ---
Summary: ...
Sections: Statement of Work; Technical Requirements; Evaluation Criteria; ...

--- Document 2: ...
```

Well under `TECH_LEAD_PRIMER_CHAR_CAP`.

### 3. New `fetch_solicitation_section` tool

**File:** `apps/functions/src/helpers/solution-plan-tools.ts` — extend `SOLUTION_PLAN_SHARED_TOOL_NAMES` (`:41-48`).

Signature:

```ts
{
  name: 'fetch_solicitation_section',
  description: 'Fetch a focused section from one of the solicitation documents listed in the manifest.',
  input_schema: {
    documentName: string;         // must match a manifest entry exactly
    keywords?: string[];          // returns ±3_000 chars around the first keyword match
    sectionHint?: string;         // heading fragment; returns the enclosing section
    // one of keywords / sectionHint required; without either → returns the doc's outline
  }
}
```

Executor (`executeSolutionPlanTool`) reads the file's cached extracted text from S3, does a case-insensitive keyword or heading search, and returns up to ~6 000 chars per call. Reuses `loadTextFromS3` (`executive-opportunity-brief.ts`) — no new S3 plumbing.

Tool result caps: 6 000 chars per response, so the transcript never balloons.

## Wiring

**File:** `apps/functions/src/helpers/document-generation.ts` (or new `solicitation-loader.ts` — see Alternatives)

Add a new function alongside the existing `loadSolicitation`:

```ts
export type SolicitationBundle =
  | { strategy: 'FULL';       text: string; documents: { name: string; chars: number }[] }
  | { strategy: 'SUMMARIZED'; summaries: DocSummary[]; totalChars: number };

export const loadSolicitationBundle = async (
  projectId: string,
  opportunityId: string,
  orgId: string,
): Promise<SolicitationBundle> => { ... };
```

Keep `loadSolicitation` (returning `string`) untouched — `edit-section.ts` and `team-matching.ts` continue to work.

`loadRoundContext` in `solution-plan-worker.ts:127-148` switches to `loadSolicitationBundle`. The bundle flows through `buildOpportunityPrimer`, `GrillerAgent`, and `TechLeadAgent` in place of the current `solicitationText: string` parameter — small, mechanical refactor.

## Tests

- `apps/functions/src/helpers/executive-opportunity-brief.test.ts`
  - Per-document budget floor: 6 files × 25 KB each with `maxChars=80_000` → every document present, each ≤ 13 KB, total ≤ 80 KB.
  - Round-robin trim: extreme case (20 files, `MIN_PER_DOC_CHARS=3_000`) — all files kept, largest trimmed.
  - Trim logging: assert a warn log naming trimmed documents.

- New `apps/functions/src/helpers/solicitation-loader.test.ts`
  - `loadSolicitationBundle` returns `FULL` when merged ≤ threshold; `SUMMARIZED` when >.
  - Env override `SOLUTION_PLAN_FULL_SOLICITATION_THRESHOLD_CHARS` respected.
  - `SUMMARIZED` uses cached `QuestionFileItem.summary` when present; falls back to on-demand summarization when absent.

- `apps/functions/src/helpers/bedrock-tool-loop.test.ts`
  - `FULL` bundle produces a request body with a `cache_control: { type: 'ephemeral' }` block on the solicitation content.

- `apps/functions/src/helpers/tech-lead-agent.test.ts` and `griller-agent.test.ts`
  - Manifest text is used as the primer in `SUMMARIZED` mode; full text in `FULL` mode.

- `apps/functions/src/helpers/solution-plan-tools.test.ts`
  - `fetch_solicitation_section` returns ±3 000 chars around the first match; returns the outline when neither `keywords` nor `sectionHint` given; enforces 6 000-char cap.

- `apps/functions/src/helpers/solicitation-summary.test.ts` (new)
  - Summary shape validated (3–5 sentences, sections list); Bedrock mocked.

## Rollout

- Behind an env flag `SOLUTION_PLAN_HYBRID_SOLICITATION=1` (default off in Prod on first deploy). Test → Dev → Prod as we validate.
- **Backfill (Layer B, extraction-time path):** ship a one-off script `scripts/backfill-solicitation-summaries.ts` that iterates existing `QuestionFileItem` rows without a `summary`, runs `summarizeSolicitationDocument`, and writes back. Run in Dev/Test first, then Prod.

## Verification

1. Unit tests — `cd apps/functions && pnpm test -- --testPathPattern="solicitation|bedrock-tool-loop|solution-plan|executive-opportunity-brief"` all green.
2. Type check — `cd apps/functions && pnpm build`.
3. Dev smoke (FULL path) — re-init the Solution Plan on `f2e4b41c-bc11-40b8-93b0-9c2c3dfd40be` (~145 KB, below 150 KB threshold). Confirm the round-1 CloudWatch log shows the full merged text length and no `[TRUNCATED]` marker; confirm cache-hit tokens appear on rounds 2–4.
4. Dev smoke (SUMMARIZED path) — upload 3 extra large PDFs to the same opportunity to push merged text over threshold. Confirm the plan enters `SUMMARIZED` mode, summaries appear on `QuestionFileItem` records, Tech Lead calls `fetch_solicitation_section` at least once, and the plan reaches `READY`.
5. Cost/latency observability — CloudWatch metrics on `cache_creation_input_tokens` vs `cache_read_input_tokens` (existing Bedrock response fields) to confirm caching kicks in on FULL runs.

## Alternatives considered (not chosen)

- **Just raise caps, no caching, no summaries** — cheapest, but every grilling round pays full input-token cost on the whole solicitation × 4 rounds + synthesis. Latency and $ blow up on real RFPs.
- **Pure RAG (embed all solicitation chunks in the KB)** — most robust long-term, but requires a per-opportunity ephemeral index or namespacing in the shared KB; larger change than the user asked for. Fold in later if hybrid doesn't cover a real case.
- **Change `loadSolicitation` signature to return the bundle** — breaks three unrelated consumers. Introducing `loadSolicitationBundle` as an additive function keeps the blast radius inside the Solution Plan path.
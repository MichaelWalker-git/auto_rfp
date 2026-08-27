# Factual-Accuracy Compliance Review — Implementation Plan <!-- ✅ IMPLEMENTED -->

> Extends AI Compliance Review to verify the submission package is **true to the
> organization's own facts** (company profile, knowledge base, past performance,
> certifications) and does not **leak NDA-protected client names** — not only that
> it is compliant with the solicitation.
>
> **This plan was hardened in a grilling session (2026-08-18).** Every non-obvious
> choice below is a deliberate decision recorded in `aidlc-docs/audit.md` (D1–D9)
> and `aidlc-docs/inception/requirements/factual-accuracy-review.md`. **Do not
> "simplify" past these decisions without re-reading the rationale** — several look
> like obvious cleanups but are the exact things that cause false-positive churn.

---

## 0. TL;DR for the implementing agent

- **Pattern:** fact-anchored **two-stage pipeline** — loose deterministic candidate
  generation (high recall) → **batched model verification** (precision gate). This
  generalizes the pattern ALREADY working in `compliance-review-consistency.ts`.
- **5 checks (C1–C5)** added as best-effort `FindingAugmenter`s to the full-review
  worker, plus one chat tool (`verify_company_facts`).
- **3 new issue types:** `FACTUAL_INACCURACY`, `UNVERIFIED_CLAIM`, `NDA_DISCLOSURE_LEAK`.
- **No new infra.** Reuse worker Lambda, Pinecone, DynamoDB.
- **Instrument everything:** `console.log(JSON.stringify({tag:'factual-candidates', factType, generated, kept}))`.
- **Golden rule:** every augmenter is fail-open (`try/catch → []`). A truth-source
  outage must NEVER fail a review.

---

## 1. Overview <!-- ✅ IMPLEMENTED -->

| | |
|---|---|
| **Trigger modes** | Full review (async worker) + Chat (`verify_company_facts` tool) |
| **Sources of truth** | Company Profile · KB (content library + chunks) · Past Performance · Certifications (KB-primary) |
| **New finding types** | `FACTUAL_INACCURACY`, `UNVERIFIED_CLAIM`, `NDA_DISCLOSURE_LEAK` |
| **Design stance** | Fact-anchored, two-stage (deterministic candidates → model verify), best-effort/fail-open, instrumented |
| **New infra** | None |
| **Packages touched** | `packages/core`, `apps/functions`; `apps/web` (labels only) |

### What exists today (READ FIRST — do not rebuild)

| File | Role | Reuse for |
|---|---|---|
| `apps/functions/src/helpers/compliance-review-engine.ts` | Agentic loop vs. solicitation; `runFullReview` has the `augmentFindings` seam | Wire C1–C5 here (§7); extend `RawFindingSchema` enum |
| `apps/functions/src/helpers/compliance-review-tools.ts` | `PackageInventory` + tools + executor | Add `verify_company_facts` (§8) |
| `apps/functions/src/helpers/compliance-review-consistency.ts` | **The reference two-stage check** (regex name phrases → 1 model call groups variants). Already reads profile name/UEI/CAGE/EIN. | EXTEND for C1 identity fields (§4) |
| `apps/functions/src/helpers/compliance-review-missing-forms.ts` | Reference best-effort `FindingAugmenter` shape | Copy the shape for C2–C5 augmenters |
| `apps/functions/src/helpers/compliance-review-validate.ts` | `validateAndTagFindings` — anchor validation + fingerprint + dedup | All findings flow through it (unchanged) |
| `apps/functions/src/helpers/compliance-review-fingerprint.ts` | Stable identity = `documentId+anchor+issueType+snippet+title` | Understand for D7 (§9) |
| `apps/functions/src/helpers/past-performance-disclosure.ts` | `getEffectiveDisclosure`, `isNameable`, `isUsableInMatching`, `redactForGeneration`, `scrubNames` regex | C4 gating + **C5 reuses the scrub logic** (§6) |
| `apps/functions/src/helpers/company-profile.ts` | `getCompanyProfile(orgId): Promise<CompanyProfileDBItem|null>` | C1, C2 |
| `apps/functions/src/helpers/past-performance.ts` | `getPastProject(orgId, id)`, `listAllPastProjects`, `listPastProjects`, `searchPastProjects` | C4 (search) + **C5 (`listAllPastProjects` — need ALL withheld names, not top-K)** |
| `apps/functions/src/helpers/semantic-search.ts` | `semanticSearchContentLibrary/Chunks/PastPerformance` | C2, C3, C4 |
| `apps/functions/src/helpers/embeddings.ts` | `getEmbedding(text)` | C3, C4 (embed a query before Pinecone search) |
| `apps/functions/src/helpers/project-kb.ts` | `getLinkedKBIds(projectId)` | C3 (scope KB search like `handlers/semanticsearch/search.ts` does) |
| `apps/functions/src/helpers/compliance-review-html.ts` | `extractHeadings(html)`, `getSectionText(html, heading, max)`, `stripHtml(html)` | C3 section chunking (§5) |
| `apps/functions/src/helpers/bedrock-http-client.ts` | `invokeModel(modelId, bodyJson)` | Stage-2 verification calls |

### Where the checks plug in

```
runFullReview (worker, Sonnet, 15-min, no 29s limit)
  └─ augmentFindings: Promise.all([
        computeMissingFormFindings,          // EXISTS
        computeConsistencyFindings,          // EXISTS — EXTEND for C1 identity fields
        computeCertFindings,                 // NEW  C2
        computeKbContradictionFindings,      // NEW  C3
        computePastPerfValueFindings,        // NEW  C4
        computeNdaLeakFindings,              // NEW  C5
     ])   // ALL best-effort → [] on failure; ALL flow through validateAndTagFindings

runChatReview (sync, Haiku, ≤5 tool rounds)
  └─ COMPLIANCE_REVIEW_TOOLS + verify_company_facts   // NEW tool → truth-source layer
```

---

## 2. The two-stage pipeline (READ — this is the whole design) <!-- ✅ IMPLEMENTED -->

Every check C1–C5 follows the same shape. Internalize it before writing any check.

```
Stage 1 — CANDIDATE GENERATION  (deterministic, cheap, tuned LOOSE = high recall)
  Given a canonical fact, cheaply find spots in the package that MIGHT
  contradict/leak it. Over-flagging here is FINE — Stage 2 cleans it up.
  Emits: candidate { factType, canonicalValue, targetKind, documentId, anchor?, snippet } list.
        │
        ▼
Stage 2 — VERIFICATION  (ONE batched model call per check, the PRECISION gate)
  Feed the model [{candidate spot text, canonical value}] and ask it to keep only
  the genuine contradictions/leaks, and (for prose) confirm/attach the anchor.
  Emits: RawFinding[] for the kept ones.
```

**Why this shape (do not undo):**
- **Token-safe:** the model only ever sees small candidate snippets — never a whole
  2000-cell questionnaire. This is why today's checks are deterministic; the pipeline
  removes that constraint without reintroducing the 200k-token blow-up.
- **Precision-only ceiling (D2/D3):** Stage 1 is the recall ceiling. If we miss a real
  problem, we loosen the **generator** (no prompt change). If we get false positives,
  Stage 2 already handles it. So model logic stays stable across iterations = fewer redeploys.
- **Because the model is the precision gate, NO fact types are pre-dropped** — even
  noisy ones like `entityType` ("LLC" in every legal clause) are safe: the verifier drops
  the boilerplate hits.

**Mandatory instrumentation (FR-9):** each check logs, once, after Stage 2:
```ts
console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C1-address', generated, kept }));
```
This is the tuning signal. Without it we are flying blind on recall.

---

## 3. Data Models & Zod Schemas — `packages/core` <!-- ✅ IMPLEMENTED -->

**File:** `packages/core/src/schemas/compliance-review.ts` (edit)

Add three issue types to `ComplianceIssueTypeSchema`:

```typescript
export const ComplianceIssueTypeSchema = z.enum([
  'MISSING_REQUIREMENT',
  'MISSING_FORM',
  'INCORRECT_ANSWER',
  'POOR_ANSWER',
  'FORMAT_ISSUE',
  'INCONSISTENCY',
  'FACTUAL_INACCURACY',  // NEW — a package claim contradicts an internal source of truth (C1, C3, C4)
  'UNVERIFIED_CLAIM',    // NEW — a claimed cert is absent / unverified / expired (C2)
  'NDA_DISCLOSURE_LEAK', // NEW — package discloses a client name that must be withheld (C5)
  'OTHER',
]);
```

**CRITICAL — also update `RawFindingSchema` in `compliance-review-engine.ts`.** Its
`issueType` enum uses `.catch('OTHER')`; a model-emitted new type silently degrades to
`OTHER` unless the value is listed there too. Add all three.

No change to `ComplianceFindingSchema` shape, target kinds, or anchor union — factual
findings reuse the existing anchors (heading/cell/field). Source-of-truth references go
in `description`/`suggestion` text (as `computeConsistencyFindings` already does).

**Verify:** `pnpm --filter @auto-rfp/core build`, then dependent typechecks.

---

## 4. C1 — Identity fields (extend the consistency check) <!-- ✅ IMPLEMENTED -->

**File:** `apps/functions/src/helpers/compliance-review-consistency.ts` (extend) — or a
sibling `computeProfileFactFindings` imported alongside it. Keep it in/next to consistency
so the "don't double-flag name/UEI/CAGE/EIN" rule (FR-3) is trivially enforced.

Fields to add beyond today's name/UEI/CAGE/EIN:
- **Deterministic-exact (high confidence, minimal Stage 2):** `primaryNaics` (6-digit,
  usually labeled "NAICS"), `zip`. Reuse `containsWord` / `containsIdentifierValue`.
- **Prose (Stage 2 verify):** `address`, `city`, `state`, `authorizedSignatory.name`,
  `entityType`. Stage 1 generates candidates by proximity to a label
  ("Address"/"Signature"/"Authorized"/"Name:"/"Title:") or partial token overlap with the
  canonical value; Stage 2 confirms it's the same fact and genuinely differs.

Per-field: emit `FACTUAL_INACCURACY` / `major`, cite both values
("profile shows `<canonical>`; document shows `<found>`"), anchor to the doc/field/cell.
Do NOT re-emit for the name/UEI/CAGE/EIN spots the existing pass already flags (dedup by
`(documentId, anchorKey)` before returning, or simply skip those fact types in the new code).

Log `factual-candidates` per field type.

---

## 5. C3 — KB prose-contradiction (package-anchored, section-chunked) <!-- ✅ IMPLEMENTED -->

**New file:** `apps/functions/src/helpers/compliance-review-kb-contradiction.ts`

Runs on **HTML RFP documents only** (forms have no prose; questionnaires are cells).

1. For each HTML doc in the inventory, split into sections via `extractHeadings(html)` +
   `getSectionText(html, heading, MAX_SECTION_CHARS)`. **Section-aligned chunking is
   mandatory** — it makes the heading a valid anchor and the section text the snippet source.
2. For each section, embed it (`getEmbedding`) and retrieve top-`FACTUAL_KB_TOP_K`
   `semanticSearchContentLibrary` hits (scoped by `getLinkedKBIds(projectId)` exactly like
   `handlers/semanticsearch/search.ts`). **HARD-GATE (FR-6):** filter hits to
   `ContentLibraryItem.approvalStatus === 'APPROVED' && !isArchived && freshnessStatus === 'ACTIVE'`.
   Do this filter in code **after loading the item** — NOT as a prompt instruction. Skip
   sections with no surviving KB hit.
3. **ONE batched model call per document:** `[{ heading, sectionText, candidateKbAnswers[] }]`
   → return only genuine contradictions as `{ heading, verbatimSnippet, kbAnswerRef, why }`.
4. Build `RawFinding`: `FACTUAL_INACCURACY` / `major`, `targetKind: 'RFP_DOCUMENT'`,
   `anchor: {kind:'heading', text: heading}` (pass the real heading back — don't trust the
   model to echo it), `snippet: verbatimSnippet` (validate.ts enforces it's a real substring;
   a paraphrase just flips `anchorValid=false`, no crash). Docs with `headings: []` produce
   anchor-less snippet-search findings — acceptable, note it.

**Anchor contract (why "go to spot" works):** `validateAndTagFindings` sets `anchorValid`
for an RFP_DOCUMENT only when the heading exists AND the snippet is a verbatim substring
(validate.ts:140-174). Section-aligned chunking + verbatim-snippet instruction satisfies both.

Recall here is **retrieval-gated** (softer ceiling than deterministic checks) — accepted,
logged via `factual-candidates`.

Constants: `FACTUAL_KB_TOP_K` (e.g. 3), `MAX_TOKENS_FACTUAL`.

---

## 6. C2 / C4 / C5 — Cert, Past-Perf value, NDA leak <!-- ✅ IMPLEMENTED -->

**Truth-source access layer — New file:** `apps/functions/src/helpers/compliance-truth-sources.ts`
Thin, reusable, all best-effort (`null`/`[]` on error). Shared by the augmenters and the chat tool.

```typescript
export const loadCompanyFacts = async (orgId: string): Promise<CompanyProfileDBItem | null>; // wraps getCompanyProfile
export const loadCertRecords = async (orgId: string, claim: string): Promise<CertRecord[]>;  // KB (gated) + profile fields[CERTIFICATION]
export const searchKnowledgeBase = async (orgId, projectId, query, k): Promise<KbHit[]>;     // getEmbedding+semanticSearch*, APPROVED/ACTIVE gate
export const searchPastPerformanceUsable = async (orgId, query, k): Promise<PastPerfFact[]>; // search + isUsableInMatching + redactForGeneration
export const listWithheldClientNames = async (orgId): Promise<WithheldName[]>;               // listAllPastProjects → non-NAMEABLE → [client, POC.name, POC.org]
```

### C2 — Certifications (`compliance-review-cert.ts`, NEW)
- Stage 1: deterministically find cert-like mentions in package text/fields (known set:
  "8(a)", "SDVOSB", "WOSB", "HUBZone", "ISO 9001/27001", "CMMI", plus `smallBusinessCertId`).
- Stage 2: model maps each mention → a cert record from `loadCertRecords` (KB primary via
  `certExpiryDate`/`approvalStatus`; profile `fields[category==='CERTIFICATION']` secondary),
  or "no match".
- Flag `UNVERIFIED_CLAIM`: no matching record OR `verified===false`/`approvalStatus!=='APPROVED'`
  → `minor`; matched record expired (`certExpiryDate`/`expiresAt`/`smallBusinessCertExpiration`
  parses to a past date vs `nowIso()`) → `major`. **Best-effort expiry parse** — unparseable
  date → do NOT flag expired (FR-4).
- Held-but-not-claimed is OUT (D4).

### C4 — Past-performance values (`compliance-review-pastperf.ts`, NEW)
- Stage 1: detect PP references in package prose (project/contract-like mentions), and extract
  nearby **formatted values** — dollar amounts (`$X`) and contract numbers.
- Stage 2: `searchPastPerformanceUsable` to retrieve the best-matching USABLE record; model
  confirms it's the same engagement; compare the stated `value`/`contractNumber` against the
  record. Mismatch → `FACTUAL_INACCURACY` / `major`.
- **NDA (FR-7):** records come pre-redacted via `redactForGeneration`; never emit a withheld
  client name. Skip fuzzy client/date prose matching in v1 (D8).

### C5 — NDA client-name leak (`compliance-review-nda-leak.ts`, NEW) — highest precision
- Stage 1 (deterministic, high recall): `listWithheldClientNames(orgId)` = every project with
  `getEffectiveDisclosure(project) !== 'NAMEABLE'`, collecting `[client, clientPOC.name,
  clientPOC.organization]`. Scan every package doc/form-field/questionnaire-cell for a
  **word-bounded, case-insensitive** match using the SAME regex `scrubNames` uses
  (`(^|[^\\w])<name>(?=[^\\w]|$)`; skip names < 3 chars). A hit = a leak candidate. Anchor is
  free (heading+snippet for HTML, field for forms, cell for questionnaires).
- Stage 2 (optional prune): for short/common names ("Delta", "Apple") one batched model call —
  "does this passage refer to the confidential client, or the common word?" — drops coincidences.
- Emit `NDA_DISCLOSURE_LEAK` / **`critical`**, description states a confidential client name
  appears at this spot and must be removed/anonymized (do not re-print it beyond the already-
  leaked location). Triggers on ALL non-NAMEABLE (D9). This closes the package as the last
  NDA-leak surface before submission (extends the existing NDA feature's leak-surface set).

Each check logs `factual-candidates`.

---

## 7. Wire into `runFullReview` <!-- ✅ IMPLEMENTED -->

**File:** `apps/functions/src/helpers/compliance-review-engine.ts` (edit `runFullReview`'s
`augmentFindings`):

```typescript
augmentFindings: async (rawFindings, inventory) => {
  const [missing, inconsistent, certs, kb, pastperf, ndaLeak] = await Promise.all([
    computeMissingFormFindings({ projectId, oppId, modelId, inventory, existingFindings: rawFindings }),
    computeConsistencyFindings({ orgId, modelId, inventory }),          // now also C1 identity fields
    computeCertFindings({ orgId, projectId, modelId, inventory }),      // C2
    computeKbContradictionFindings({ orgId, projectId, modelId, inventory }), // C3
    computePastPerfValueFindings({ orgId, modelId, inventory }),        // C4
    computeNdaLeakFindings({ orgId, modelId, inventory }),              // C5
  ]);
  return [...missing, ...inconsistent, ...certs, ...kb, ...pastperf, ...ndaLeak];
},
```

All flow through `validateAndTagFindings` (FR-8) — fingerprint/decision persistence is automatic.
Update `SYSTEM_PROMPT` to describe factual accuracy + the 3 new issue types so the model can
also surface them conversationally.

---

## 8. Chat tool — `verify_company_facts` <!-- ✅ IMPLEMENTED -->

**File:** `apps/functions/src/helpers/compliance-review-tools.ts` (edit)

```
verify_company_facts
  input: { claim: string, sources?: ("profile"|"kb"|"certs"|"past_performance")[] }
  returns: profile fact snapshot + gated KB hits + usable(redacted) PP facts + cert records relevant to `claim`
```
Executor delegates to `compliance-truth-sources.ts`. Keep chat bounded (`MAX_TOOL_ROUNDS = 5`)
— one more option, not a mandatory scan (NFR-1). Update `SYSTEM_PROMPT` to instruct calling it
before asserting a claim's accuracy.

---

## 9. Fingerprint behavior (D7 — accepted MVP tradeoff) <!-- ✅ IMPLEMENTED -->

- **Deterministic findings (C1 exact, C2, C4, C5):** code-generated snippet/title →
  byte-stable fingerprint → dismissals persist across re-runs. This is most of the feature.
- **Model-authored prose findings (C1 prose, C3):** may resurface once after a substantial
  reword (different snippet/title → different fingerprint). Same tradeoff the existing engine
  documents. Accepted for v1; do NOT invent a new identity scheme under deadline.

---

## 10. Constants <!-- ✅ IMPLEMENTED -->

**File:** `apps/functions/src/constants/compliance-review.ts` (edit) — add:
`FACTUAL_KB_TOP_K` (≈3), `FACTUAL_PP_TOP_K` (≈3), `MAX_TOKENS_FACTUAL`,
`MAX_FACTUAL_CANDIDATES_PER_CHECK` (Stage-1 cap so a pathological package can't explode Stage 2).

---

## 11. Tests (co-located, per `.claude/rules/09-testing.md`) <!-- ✅ IMPLEMENTED -->

| File | Covers |
|---|---|
| `packages/core/src/schemas/compliance-review.test.ts` | 3 new enum values parse; existing findings still valid (Vitest) |
| `apps/functions/src/helpers/compliance-truth-sources.test.ts` | Each loader; KB gate (DRAFT/DEPRECATED/archived/STALE excluded); PP gating (DO_NOT_USE excluded, client redacted); fail-open → `[]` |
| `apps/functions/src/helpers/compliance-review-consistency.test.ts` | EXTEND: address/NAICS/zip/signatory/entityType candidate+verify; no double-flag with existing name/ID pass |
| `apps/functions/src/helpers/compliance-review-cert.test.ts` | absent/unverified/DEPRECATED → minor; expired → major; unparseable expiry → not flagged; `[]` on model failure |
| `apps/functions/src/helpers/compliance-review-kb-contradiction.test.ts` | section chunking; APPROVED/ACTIVE gate; heading+verbatim-snippet anchor valid; heading-less doc degrades; `[]` on failure |
| `apps/functions/src/helpers/compliance-review-pastperf.test.ts` | value/contract mismatch flagged; NDA redaction never emits client name; `[]` on failure |
| `apps/functions/src/helpers/compliance-review-nda-leak.test.ts` | word-bounded match (no substring false-positive); all non-NAMEABLE trigger; NAMEABLE never; `critical`; short-name model prune; `[]` on failure |
| `apps/functions/src/helpers/compliance-review-tools.test.ts` | `verify_company_facts` happy path + error → safe content |

Mock AWS SDK + `invokeModel`/`invokeClaudeWithTools`; reset in `beforeEach`; test exported
functions, not the middy handler.

---

## 12. Frontend — labels only <!-- ✅ IMPLEMENTED -->

No structural change. Add labels/badges for the 3 new issue types wherever
`ComplianceIssueType` maps to a label/icon in `apps/web/features/compliance-review/`
(`NDA_DISCLOSURE_LEAK` should read as critical/red). Findings render through the existing
`FindingsList` path.

---

## 13. Implementation tickets <!-- ✅ IMPLEMENTED -->

| # | Ticket | Files | Est. |
|---|---|---|---|
| FA-1 | Core: 3 issue types (+ `RawFindingSchema` enum in engine) | `compliance-review.ts`, `compliance-review-engine.ts`, core test | 30 min |
| FA-2 | Constants/bounds | `constants/compliance-review.ts` | 15 min |
| FA-3 | Truth-source access layer + tests | `compliance-truth-sources.ts` | 3 h |
| FA-4 | C5 NDA leak (highest precision, do FIRST — proves the pipeline) | `compliance-review-nda-leak.ts` + test | 3 h |
| FA-5 | C1 identity fields (extend consistency) | `compliance-review-consistency.ts` + test | 4 h |
| FA-6 | C2 certifications | `compliance-review-cert.ts` + test | 4 h |
| FA-7 | C3 KB prose-contradiction | `compliance-review-kb-contradiction.ts` + test | 5 h |
| FA-8 | C4 past-perf values | `compliance-review-pastperf.ts` + test | 4 h |
| FA-9 | Wire augmenters + system prompt into `runFullReview` | `compliance-review-engine.ts` | 45 min |
| FA-10 | Chat `verify_company_facts` tool | `compliance-review-tools.ts` + test | 3 h |
| FA-11 | Frontend labels | `apps/web/features/compliance-review/` | 1 h |

**Order:** FA-1 → FA-2 → FA-3 → **FA-4 (proves the two-stage pipeline end-to-end on the
crispest check)** → FA-5 → FA-6 → FA-7 → FA-8 → FA-9 → FA-10 → FA-11. Rebuild `@auto-rfp/core`
after FA-1. Verify `pnpm tsc --noEmit` after each backend ticket.

---

## 14. Acceptance criteria <!-- ✅ IMPLEMENTED -->

- [x] Full review emits the 3 new issue types for C1–C5.
- [x] Chat answers "is this claim accurate?" via `verify_company_facts`.
- [x] Expired/unverified/absent certs → `UNVERIFIED_CLAIM`; KB-primary source honored.
- [x] KB contradiction runs ONLY against `APPROVED && !isArchived && ACTIVE` entries (gate in code).
- [x] NDA leak: any non-NAMEABLE client name in the package → `NDA_DISCLOSURE_LEAK` / `critical`,
      anchored to the spot; NAMEABLE never flagged; word-bounded (no substring false-positive).
- [x] Every factual finding cites its source-of-truth value and anchors to a real spot
      (passes `validateAndTagFindings`); "go to spot" works for heading/field/cell anchors.
- [x] PP verification never leaks a redacted client name.
- [x] EVERY check is fail-open (`try/catch → []`) — truth-source outage never fails a review.
- [x] No double-flag of the name/UEI/CAGE/EIN spots the existing consistency pass covers.
- [x] Every check emits the structured `factual-candidates` instrumentation line.
- [x] Co-located tests for all new/changed code; `pnpm tsc --noEmit` passes per package.
- [x] No new CDK stacks / infra cost.

---

## 15. Summary of new/changed files <!-- ✅ IMPLEMENTED -->

| File | Change | Status |
|---|---|---|
| `packages/core/src/schemas/compliance-review.ts` | +3 issue types | ✅ |
| `apps/functions/src/helpers/compliance-truth-sources.ts` | NEW — truth-source access layer | ✅ |
| `apps/functions/src/helpers/compliance-review-nda-leak.ts` | NEW — C5 | ✅ |
| `apps/functions/src/helpers/compliance-review-cert.ts` | NEW — C2 | ✅ |
| `apps/functions/src/helpers/compliance-review-kb-contradiction.ts` | NEW — C3 | ✅ |
| `apps/functions/src/helpers/compliance-review-pastperf.ts` | NEW — C4 | ✅ |
| `apps/functions/src/helpers/compliance-review-consistency.ts` | EXTEND — C1 identity fields | ✅ |
| `apps/functions/src/helpers/compliance-review-engine.ts` | wire augmenters + prompt + `RawFindingSchema` enum | ✅ |
| `apps/functions/src/helpers/compliance-review-tools.ts` | +`verify_company_facts` | ✅ |
| `apps/functions/src/constants/compliance-review.ts` | +bounds | ✅ |
| `apps/web/features/compliance-review/*` | issue-type labels | ✅ |
| `*.test.ts` (8 files, §11) | tests | ✅ |

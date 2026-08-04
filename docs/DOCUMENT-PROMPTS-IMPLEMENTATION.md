# Document Generation Prompts — Implementation Plan

> Per-document-type prompt overrides (guidance + task fragments) managed on the
> Prompts settings page, in a new **Document Generation** tab.

---

## 1. Overview <!-- ⏳ PENDING -->

| | |
|---|---|
| **Feature** | Org-level overrides for the per-document-type prompt fragments used by RFP document generation |
| **Why** | Today `DOC_TYPE_GUIDANCE` / `DOC_TYPE_TASK` in `apps/functions/src/helpers/document-prompts.ts` are fully hardcoded. The prompt management page only affects answer generation, executive brief, and clarifying questions. Editing `RFP_DOCUMENT`/`TECHNICAL_PROPOSAL` there does nothing. |
| **Scope** | All ~16 built-in generatable document types (the `STANDARD_TYPES` list in `generate-document-dialog.tsx`, minus `CLARIFYING_QUESTIONS`/`QUESTIONS_AND_ANSWERS` which have dedicated pipelines — see §3). Custom document types are out of scope for v1 but the SK design supports them later. |
| **Granularity** | **Fragment-only override.** Orgs edit the type-specific guidance (SYSTEM scope) and task (USER scope) fragments. The surrounding skeleton (JSON schema, HTML requirements, template-preservation rules, tool instructions) stays system-owned and non-editable. |
| **Affected packages** | `packages/core`, `apps/functions`, `packages/infra` (routes only), `apps/web` |

### Decisions (locked)

| Decision | Choice |
|---|---|
| Override granularity | Fragment only (guidance/task), never the full prompt |
| Storage | Composite SK `{orgId}#RFP_DOCUMENT#{documentType}` under existing `SYSTEM_PROMPT`/`USER_PROMPT` PKs |
| Type scope | All built-in generatable types; custom types deferred (design allows) |
| Runtime resolution | Fetch once per generation job; on read error, log + silently fall back to hardcoded defaults |
| Reset | New `DELETE /prompt/delete-prompt/{scope}` route using the existing (unused) `prompt:delete` permission; UI "Reset to default" button |
| Permissions | Standardize on `prompt:*`: fix frontend `PermissionButton` to `prompt:create` (was `org:manage_settings`); reset uses `prompt:delete` |
| Dead types | Remove `RFP_DOCUMENT`, `PROPOSAL`, `TECHNICAL_PROPOSAL` from the AI Features tab UI; keep enum values + DB rows (no migration) |
| Defaults exposure | `get-prompts` synthesizes defaults with `isDefault: true` (same pattern as feature prompts); prompt maps stay in `apps/functions` |
| COST_PROPOSAL default | Fix in this feature: give it complete standalone guidance instead of "(Same guidance as PRICE_VOLUME — see above)" |
| Edit path | Overrides apply to **both** the generation worker and `edit-section.ts` |
| Validation | `min(1)`, `max(8000)` chars per fragment; `documentType` validated against the built-in enum |
| API shape | Extend existing `save-prompt`/`get-prompts` handlers (optional `documentType` field; new `document` group in response) |

---

## 2. Architecture Overview <!-- ⏳ PENDING -->

```
┌────────────────────────── apps/web ──────────────────────────┐
│ /organizations/[orgId]/settings/prompts                      │
│ ┌─ Tabs ────────────────────────────────────────────────────┐│
│ │ [AI Features]            [Document Generation]  ← NEW     ││
│ │  existing PromptRow list  DocumentPromptRow per doc type  ││
│ │  (RFP_DOCUMENT/PROPOSAL/  SYSTEM = guidance fragment      ││
│ │   TECHNICAL_PROPOSAL      USER   = task fragment          ││
│ │   filtered out)           + Reset to default              ││
│ └───────────────────────────────────────────────────────────┘│
└──────────────┬────────────────────────────────────────────────┘
               │ GET  /prompt/get-prompts            → { system, user, document }
               │ POST /prompt/save-prompt/{scope}    body may carry documentType
               │ DELETE /prompt/delete-prompt/{scope} ← NEW (reset)
┌──────────────▼──────────── apps/functions ───────────────────┐
│ handlers/prompt/{get-prompts, save-prompt, delete-prompt}    │
│ helpers/prompt.ts                                            │
│   SK feature prompt:  {orgId}#{type}                         │
│   SK document prompt: {orgId}#RFP_DOCUMENT#{documentType}    │
│                                                              │
│ helpers/document-prompt-overrides.ts  ← NEW                  │
│   resolveDocumentPromptFragments(orgId, documentType)        │
│   → { guidance?, task? } (null-safe, silent fallback)        │
│                                                              │
│ helpers/generate-document-worker.ts                          │
│   fetch fragments once per job → pass into builders          │
│ helpers/document-prompts.ts                                  │
│   builders accept optional overrides param                   │
│ handlers/rfp-document/edit-section.ts                        │
│   injects guidance fragment into edit system prompt          │
└──────────────────────────────────────────────────────────────┘
```

Single-table DynamoDB items (no new PKs, no GSI changes):

| Entity | PK | SK | Notes |
|---|---|---|---|
| Feature prompt (existing) | `SYSTEM_PROMPT` / `USER_PROMPT` | `{orgId}#{type}` | unchanged |
| Document prompt (new) | `SYSTEM_PROMPT` / `USER_PROMPT` | `{orgId}#RFP_DOCUMENT#{documentType}` | `RFP_DOCUMENT` literal is the namespace segment |

The existing `get-prompts` org query (`begins_with(sk, '{orgId}#')`) already returns
both shapes; items are split into groups by SK segment count / `documentType` attribute.

---

## 3. Data Models & Zod Schemas <!-- ✅ IMPLEMENTED -->

File: `packages/core/src/schemas/prompt.ts` (extend in place).

```typescript
import { z } from 'zod';

// ── existing (unchanged) ──
export const PromptScopeSchema = z.enum(['SYSTEM', 'USER']);
export type PromptScope = z.infer<typeof PromptScopeSchema>;

export const PromptTypeSchema = z.enum([/* unchanged — legacy types stay for data compat */]);

// ── NEW: document types whose prompts can be overridden ──
// Excludes CLARIFYING_QUESTIONS / QUESTIONS_AND_ANSWERS / QUESTIONNAIRE (dedicated
// pipelines, not driven by DOC_TYPE_GUIDANCE/DOC_TYPE_TASK) and non-generated
// admin types (NDA, CONTRACT, …).
export const DocumentPromptTypeSchema = z.enum([
  'COVER_LETTER',
  'EXECUTIVE_SUMMARY',
  'UNDERSTANDING_OF_REQUIREMENTS',
  'TECHNICAL_PROPOSAL',
  'PROJECT_PLAN',
  'TEAM_QUALIFICATIONS',
  'PAST_PERFORMANCE',
  'COST_PROPOSAL',
  'MANAGEMENT_APPROACH',
  'RISK_MANAGEMENT',
  'COMPLIANCE_MATRIX',
  'CERTIFICATIONS',
  'APPENDICES',
  'MANAGEMENT_PROPOSAL',
  'PRICE_VOLUME',
  'QUALITY_MANAGEMENT',
]);
export type DocumentPromptType = z.infer<typeof DocumentPromptTypeSchema>;

/** Max chars per fragment. Fragments are ~1–2k today; the cap protects the
 *  generation context budget from oversized pastes. */
export const DOCUMENT_PROMPT_MAX_LENGTH = 8000;

// ── NEW: document prompt item (returned by get-prompts `document` group) ──
export const DocumentPromptItemSchema = z.object({
  documentType: DocumentPromptTypeSchema,
  scope: PromptScopeSchema,
  prompt: z.string(),
  orgId: z.string().optional(),
  isDefault: z.boolean().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type DocumentPromptItem = z.infer<typeof DocumentPromptItemSchema>;

// ── save-prompt body: discriminate feature vs document prompt ──
export const SavePromptBodySchema = z.object({           // existing, unchanged
  type: PromptTypeSchema,
  prompt: z.string().min(1, 'prompt is required'),
  params: z.array(z.string()).optional(),
});

export const SaveDocumentPromptBodySchema = z.object({    // NEW
  documentType: DocumentPromptTypeSchema,
  prompt: z.string().min(1).max(DOCUMENT_PROMPT_MAX_LENGTH),
});
export type SaveDocumentPromptBody = z.infer<typeof SaveDocumentPromptBodySchema>;

export const DeleteDocumentPromptBodySchema = z.object({  // NEW (reset)
  documentType: DocumentPromptTypeSchema,
});
export type DeleteDocumentPromptBody = z.infer<typeof DeleteDocumentPromptBodySchema>;
```

Notes:
- No `params` on document prompts — fragments have no `{{PLACEHOLDER}}` substitution;
  context is injected by the pipeline.
- No 5-type entity pattern here: this is a config record keyed by org+type, not a
  listable domain entity with ids. It follows the existing `PromptItem` precedent.
  (Documented deviation per `.claude/rules/03-entity-definitions.md`.)
- Rebuild core after schema changes: `pnpm --filter @auto-rfp/core build`.

---

## 4. DynamoDB Design <!-- ✅ IMPLEMENTED -->

No new PK constants. SK builders in `apps/functions/src/helpers/prompt.ts`:

```typescript
/** Namespace segment for document-generation prompt overrides. */
const DOCUMENT_PROMPT_SK_SEGMENT = 'RFP_DOCUMENT';

const buildFeaturePromptSk = (orgId: string, type: PromptType) =>
  `${orgId}#${type}`;

const buildDocumentPromptSk = (orgId: string, documentType: DocumentPromptType) =>
  `${orgId}#${DOCUMENT_PROMPT_SK_SEGMENT}#${documentType}`;
```

New helper functions (same file, wrapping existing `docClient` patterns):

```typescript
export const saveDocumentPrompt = async (
  orgId: string,
  scope: PromptScope,
  documentType: DocumentPromptType,
  prompt: string,
) => { /* UpdateCommand upsert, PK = scope-based, SK = buildDocumentPromptSk(...) ;
         sets documentType attr so items are distinguishable when queried */ };

export const readDocumentPrompt = async (
  orgId: string,
  scope: PromptScope,
  documentType: DocumentPromptType,
): Promise<DocumentPromptItem | null> => { /* GetCommand */ };

export const deleteDocumentPrompt = async (
  orgId: string,
  scope: PromptScope,
  documentType: DocumentPromptType,
) => { /* DeleteCommand */ };
```

**SK collision note:** legacy feature-prompt rows `{orgId}#RFP_DOCUMENT` /
`{orgId}#PROPOSAL` (2 segments) do NOT collide with new rows
`{orgId}#RFP_DOCUMENT#{documentType}` (3 segments). The org-prefix query returns
both; the handler splits them by presence of the `documentType` attribute.

---

## 5. Backend — Runtime Resolution <!-- 🚧 IN PROGRESS --> <!-- 5.1–5.3 done (DP-3/DP-4); 5.4–5.5 pending (DP-5) -->

### 5.1 New helper: `apps/functions/src/helpers/document-prompt-overrides.ts`

```typescript
export interface DocumentPromptFragments {
  guidance: string | null;  // SYSTEM-scope override or null
  task: string | null;      // USER-scope override or null
}

/**
 * Fetch org overrides for a document type. NEVER throws — document generation
 * must not fail because of prompt management. On any error, logs and returns nulls
 * (hardcoded defaults apply).
 */
export const resolveDocumentPromptFragments = async (
  orgId: string,
  documentType: string,
): Promise<DocumentPromptFragments> => {
  const { success, data } = DocumentPromptTypeSchema.safeParse(documentType);
  if (!success) return { guidance: null, task: null }; // custom/unknown types → defaults

  try {
    const [sys, usr] = await Promise.all([
      readDocumentPrompt(orgId, 'SYSTEM', data),
      readDocumentPrompt(orgId, 'USER', data),
    ]);
    return { guidance: sys?.prompt?.trim() || null, task: usr?.prompt?.trim() || null };
  } catch (err) {
    console.warn(`[document-prompts] Override read failed for ${documentType}, using defaults:`, (err as Error).message);
    return { guidance: null, task: null };
  }
};
```

### 5.2 Builder changes: `apps/functions/src/helpers/document-prompts.ts`

Builders stay pure/sync; overrides are passed in:

```typescript
export const buildSystemPromptForDocumentType = (
  documentType: string,
  templateHtmlScaffold?: string | null,
  guidanceOverride?: string | null,          // NEW
): string => {
  const guidance = guidanceOverride ?? DOC_TYPE_GUIDANCE[documentType] ?? DEFAULT_GUIDANCE(typeLabel);
  // ...rest unchanged
};

export const buildSectionSystemPrompt = (
  documentType: string,
  guidanceOverride?: string | null,          // NEW — same substitution
): string => { /* ... */ };

export function buildUserPromptForDocumentType(
  documentType: string,
  solicitation: string,
  qaText: string,
  enrichedKbText: string,
  taskOverride?: string | null,              // NEW
): string {
  const taskInstructions = taskOverride ?? DOC_TYPE_TASK[documentType] ?? DEFAULT_TASK(typeLabel);
  // ...rest unchanged
}
```

### 5.3 Fix `DOC_TYPE_GUIDANCE.COST_PROPOSAL` (same file, line ~529)

Replace the broken "(Same guidance as PRICE_VOLUME — see above)" reference with
complete standalone guidance: PRICE_VOLUME's full structure (Pricing Summary →
Basis of Estimate → Labor Categories & Rates → ODCs → Cost Narrative) **plus** the
existing cost-realism additions (traceability, certifications/representations,
`get_pricing_data` instruction). This text also becomes the default shown in the UI.

### 5.4 Worker wiring: `apps/functions/src/helpers/generate-document-worker.ts` (Step 5, ~line 1022)

```typescript
// ─── Step 5: Build prompts ───
const fragments = await resolveDocumentPromptFragments(orgId, documentType); // once per job
const systemPrompt = buildSystemPromptForDocumentType(documentType, templateHtmlScaffold, fragments.guidance);
const userPrompt = buildUserPromptForDocumentType(documentType, solicitation, JSON.stringify(qaPairs), enrichedKbText, fragments.task);
// Strategy 1 (~line 1051):
const sectionSystemPrompt = buildSectionSystemPrompt(documentType, fragments.guidance);
// Strategy 2 (~line 1074):
const singleShotSystemPrompt = buildSystemPromptForDocumentType(documentType, templateHtmlScaffold ?? null, fragments.guidance);
```

### 5.5 Edit path: `apps/functions/src/handlers/rfp-document/edit-section.ts`

`buildSectionEditSystemPrompt` gains an optional `guidanceOverride` (and falls back
to `DOC_TYPE_GUIDANCE[doc.documentType]`); the handler already loads the document
(`doc.documentType ?? 'TECHNICAL_PROPOSAL'`, line 231) and has `orgId` — call
`resolveDocumentPromptFragments` once and inject a short
`DOCUMENT TYPE GUIDANCE` section into the edit system prompt so edited sections
follow the same custom guidance as generated ones.

---

## 6. Backend — Handler Changes <!-- ⏳ PENDING -->

### 6.1 `save-prompt.ts` (extend)

- Body may now be either `SavePromptBodySchema` (feature) or
  `SaveDocumentPromptBodySchema` (document). Discriminate on `documentType` presence:

```typescript
const isDocumentPrompt = typeof (bodyRaw as Record<string, unknown>)?.documentType === 'string';
if (isDocumentPrompt) {
  const { success, data, error } = SaveDocumentPromptBodySchema.safeParse(bodyRaw);
  if (!success) return apiResponse(400, { ok: false, error: error.flatten() });
  const saved = await saveDocumentPrompt(orgId, scope, data.documentType, data.prompt);
  // audit: CONFIG_CHANGED / config / prompt (unchanged pattern)
  return apiResponse(200, { ok: true, item: saved });
}
// existing feature-prompt path unchanged
```

### 6.2 `get-prompts.ts` (extend)

- Split queried rows: items with a `documentType` attribute → `document` group;
  rest → `system`/`user` as today.
- Merge defaults for all `DocumentPromptTypeSchema.options` × both scopes, using
  `DOC_TYPE_GUIDANCE` (SYSTEM) and `DOC_TYPE_TASK` (USER) imported from
  `@/helpers/document-prompts` (export the two maps, or add
  `getDefaultGuidance(type)` / `getDefaultTask(type)` accessors), with
  `isDefault: true`.
- Response becomes `{ ok, items: { system, user, document } }` — additive, no
  breaking change for existing consumers.
- **Cleanup:** remove `PROPOSAL` from the default maps in this handler so the dead
  type stops being synthesized (per "remove from UI, keep data").

### 6.3 NEW `delete-prompt.ts` (reset to default)

Thin handler: parse `scope` path param + `DeleteDocumentPromptBodySchema` body →
`deleteDocumentPrompt(orgId, scope, documentType)` → `apiResponse(200, { ok: true })`.

Middleware: `authContextMiddleware → orgMembershipMiddleware →
requirePermission('prompt:delete') → auditMiddleware → httpErrorMiddleware`;
audit as `CONFIG_CHANGED / config / prompt`. Wrapped in `withSentryLambda`.
(v1 supports document prompts only; feature-prompt reset can be added later.)

---

## 7. REST API Routes <!-- ⏳ PENDING -->

`packages/infra/api/routes/prompt.routes.ts`:

```typescript
routes: [
  { method: 'POST',   path: 'save-prompt/{scope}',   entry: lambdaEntry('prompt/save-prompt.ts') },
  { method: 'GET',    path: 'get-prompts',           entry: lambdaEntry('prompt/get-prompts.ts') },
  { method: 'DELETE', path: 'delete-prompt/{scope}', entry: lambdaEntry('prompt/delete-prompt.ts') }, // NEW
],
```

Domain already registered in `api-orchestrator-stack.ts` — no orchestrator change.
New Lambda needs its explicit CloudWatch Log Group (2-week retention non-prod) —
follow the existing pattern for the prompt domain's lambdas.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/prompt/get-prompts?orgId=` | `prompt:read` | Feature + document prompts, defaults merged |
| POST | `/prompt/save-prompt/{scope}?orgId=` | `prompt:create` | Save feature or document prompt (body discriminated) |
| DELETE | `/prompt/delete-prompt/{scope}?orgId=` | `prompt:delete` | Reset document prompt to default |

---

## 8. Frontend — Hooks & Components <!-- ⏳ PENDING -->

### 8.1 Hooks (`apps/web/lib/hooks/use-prompt.ts`, extend)

- `usePrompts(orgId)` → also returns `document: DocumentPromptItem[]` from the new
  response group. Update the hand-rolled validator; **replace the hardcoded
  `validTypes` array** with `PromptTypeSchema.options` /
  `DocumentPromptTypeSchema.options` so it can't drift from core again.
- `useSavePrompt(orgId)` → accepts the document-prompt body variant.
- NEW `useDeletePrompt(orgId)` → SWR mutation for the DELETE route.
- `apps/web/lib/prompt/prompt-api.ts` → add `deletePromptUrl(scope, orgId)`.

### 8.2 Page structure (`PromptManager.tsx` → tabs)

```
components/organizations/
├── PromptManager.tsx          # becomes Tabs container
├── FeaturePromptsTab.tsx      # extracted current list (filters out RFP_DOCUMENT, PROPOSAL, TECHNICAL_PROPOSAL)
├── DocumentPromptsTab.tsx     # NEW
├── DocumentPromptRow.tsx      # NEW
└── CreatePromptDialog.tsx     # unchanged (feature prompts only)
```

- Shadcn `Tabs`: **AI Features** | **Document Generation**. Tab state in URL via
  `nuqs` (`?tab=documents`).
- `DocumentPromptsTab`: header explainer — *"You are editing the document-type
  guidance and task instructions. Output format, template preservation, and tool
  rules are managed by the system and cannot be overridden."* One
  `DocumentPromptRow` per `DocumentPromptTypeSchema` option, in the win-optimized
  order from `RFP_DOCUMENT_TYPES`, with `RFP_DOCUMENT_TYPE_DESCRIPTIONS[type]` as
  row subtitle.
- `DocumentPromptRow`: collapsible editor like `PromptRow`, but:
  - SYSTEM row labeled **"Guidance"**, USER row labeled **"Task instructions"**.
  - Textarea pre-filled with default text when `isDefault: true`; `Default` badge
    vs `Customized` badge.
  - Char counter with the 8,000 limit; save disabled beyond it.
  - **Reset to default** button (visible only when customized) → confirm dialog →
    `useDeletePrompt` → refresh. Gated on `prompt:delete`.
  - No "Runtime params" panel.
- **Permission fix:** all Save buttons (both tabs) switch from
  `org:manage_settings` to `prompt:create`.
- Loading: `Skeleton` rows (existing pattern). Tests in `__tests__/` per rules.

---

## 9. Permissions & RBAC <!-- ⏳ PENDING -->

No new permissions. Existing `PROMPT_PERMISSIONS` cover everything:

| Action | Permission | Status |
|---|---|---|
| View prompts page / defaults | `prompt:read` | already enforced |
| Save override (both tabs) | `prompt:create` | backend enforced; **frontend fixed** from `org:manage_settings` |
| Reset to default | `prompt:delete` | previously unused — now enforced by new handler |

Only ADMIN holds `prompt:*` today via `ALL_PERMISSIONS` — unchanged.

---

## 10. Testing <!-- ⏳ PENDING -->

| Area | File | Cases |
|---|---|---|
| SK builders + helpers | `helpers/prompt.test.ts` | document SK shape; save/read/delete round-trip (mocked docClient); no collision with 2-segment legacy SKs |
| Override resolution | `helpers/document-prompt-overrides.test.ts` | override found; not found → nulls; DDB error → nulls + warn (never throws); unknown/custom type → nulls |
| Prompt builders | `helpers/document-prompts.test.ts` | `guidanceOverride`/`taskOverride` substitute only the fragment; skeleton (JSON schema, HTML rules) intact; fallback order override → map → DEFAULT_* ; new COST_PROPOSAL default is standalone (no "see above") |
| save-prompt | `handlers/prompt/save-prompt.test.ts` | document body accepted; >8000 chars → 400; unknown documentType → 400; feature path regression-safe |
| get-prompts | `handlers/prompt/get-prompts.test.ts` | rows split into 3 groups; defaults synthesized for all 16 types × 2 scopes; override suppresses its default; PROPOSAL no longer synthesized |
| delete-prompt | `handlers/prompt/delete-prompt.test.ts` | happy path; invalid scope/type → 400; audit context set |
| Worker | `helpers/generate-document-worker.test.ts` | fragments fetched once per job and passed to all three builders (both strategies) |
| edit-section | `handlers/rfp-document/edit-section.test.ts` | guidance override injected into edit system prompt |
| Schemas | `packages/core/src/schemas/prompt.test.ts` (vitest) | enum contents; length cap; body schemas |
| Frontend | `__tests__/` for tab components | tabs render; dead types filtered from AI Features; default vs customized badges; reset flow; permission gating |

Test the exported business functions directly (not middy-wrapped handlers); mock
middy + AWS SDK before imports per `.claude/rules/09-testing.md`.

---

## 11. Implementation Tickets <!-- ⏳ PENDING -->

### DP-1 · Core schemas (S) <!-- ✅ IMPLEMENTED -->
`DocumentPromptTypeSchema`, `DocumentPromptItemSchema`, `SaveDocumentPromptBodySchema`,
`DeleteDocumentPromptBodySchema`, `DOCUMENT_PROMPT_MAX_LENGTH` in
`packages/core/src/schemas/prompt.ts` + vitest tests. Rebuild core.

### DP-2 · DB helpers + SK builders (S) <!-- ✅ IMPLEMENTED -->
`buildDocumentPromptSk`, `saveDocumentPrompt`, `readDocumentPrompt`,
`deleteDocumentPrompt` in `helpers/prompt.ts` + tests.

### DP-3 · Fix COST_PROPOSAL default + export defaults (S) <!-- ✅ IMPLEMENTED -->
Standalone COST_PROPOSAL guidance in `DOC_TYPE_GUIDANCE`; export
`getDefaultGuidance`/`getDefaultTask` accessors for get-prompts.

### DP-4 · Builder override params + resolution helper (M) <!-- ✅ IMPLEMENTED -->
`guidanceOverride`/`taskOverride` params on the three builders;
`document-prompt-overrides.ts` with silent-fallback resolver; tests.

### DP-5 · Worker + edit-section wiring (M) <!-- ⏳ PENDING -->
Fetch-once in `generate-document-worker.ts` Step 5 (both strategies);
guidance injection in `edit-section.ts`; update both test files.

### DP-6 · Handlers: save/get extend + delete new (M) <!-- ⏳ PENDING -->
Body discrimination in `save-prompt.ts`; 3-group response + document defaults +
drop PROPOSAL synthesis in `get-prompts.ts`; new `delete-prompt.ts`; tests.

### DP-7 · Route + log group (S) <!-- ⏳ PENDING -->
DELETE route in `prompt.routes.ts`; CloudWatch Log Group for the new Lambda.

### DP-8 · Frontend hooks (S) <!-- ⏳ PENDING -->
`document` group in `usePrompts` (validTypes from schema options),
`useSavePrompt` variant, `useDeletePrompt`, `deletePromptUrl`.

### DP-9 · Frontend tabs UI (L) <!-- ⏳ PENDING -->
Tabs container (`nuqs` tab state); `FeaturePromptsTab` (dead types filtered,
permission fix); `DocumentPromptsTab` + `DocumentPromptRow` (default/customized
badges, char cap, reset with confirm); component tests.

### DP-10 · E2E sanity (S) <!-- ⏳ PENDING -->
Playwright: open prompts page → Document tab → edit COST_PROPOSAL guidance → save
→ verify customized badge → reset → verify default badge.

Suggested order: DP-1 → DP-2 → DP-3 → DP-4 → DP-5 → DP-6 → DP-7 → DP-8 → DP-9 → DP-10.
DP-3..5 (runtime) and DP-6..9 (management surface) can proceed in parallel after DP-2.

---

## 12. Acceptance Criteria <!-- ⏳ PENDING -->

- [ ] Prompts page shows two tabs; AI Features tab no longer lists RFP_DOCUMENT, PROPOSAL, TECHNICAL_PROPOSAL.
- [ ] Document Generation tab lists all 16 built-in types with default guidance/task text pre-filled and `Default` badges.
- [ ] Saving a guidance override changes the generated document's DOCUMENT TYPE section (both single-shot and section-by-section) for that org only.
- [ ] Saving a task override changes the user prompt's TASK section.
- [ ] AI section editing (`edit-section`) uses the org's guidance override.
- [ ] Overrides never replace the skeleton: JSON schema, HTML requirements, template-preservation rules unchanged in emitted prompts.
- [ ] A DynamoDB read failure during generation falls back to defaults and generation succeeds (warn logged).
- [ ] Reset to default deletes the row; the type shows default text again; generation reverts to hardcoded fragment.
- [ ] Fragment saves >8,000 chars or with unknown documentType are rejected with 400.
- [ ] Save requires `prompt:create`, reset requires `prompt:delete` (backend) and buttons are gated accordingly (frontend).
- [ ] COST_PROPOSAL default guidance is complete standalone text (no "see above" reference).
- [ ] Custom document types keep generic defaults and cause no errors in resolution.
- [ ] All affected packages pass `tsc --noEmit`; all new/updated tests pass.

---

## 13. Summary of New / Changed Files <!-- ⏳ PENDING -->

| File | Change | Status |
|---|---|---|
| `packages/core/src/schemas/prompt.ts` | extend: document prompt schemas | ✅ |
| `packages/core/src/schemas/prompt.test.ts` | new/extend vitest tests | ✅ |
| `apps/functions/src/helpers/prompt.ts` | extend: document SK + CRUD helpers | ✅ |
| `apps/functions/src/helpers/prompt.test.ts` | extend | ✅ |
| `apps/functions/src/helpers/document-prompt-overrides.ts` | **new**: resolver | ✅ |
| `apps/functions/src/helpers/document-prompt-overrides.test.ts` | **new** | ✅ |
| `apps/functions/src/helpers/document-prompts.ts` | extend: override params; fix COST_PROPOSAL; default accessors | ✅ |
| `apps/functions/src/helpers/document-prompts.test.ts` | extend | ✅ |
| `apps/functions/src/helpers/generate-document-worker.ts` | extend: fetch-once wiring | ⏳ |
| `apps/functions/src/handlers/rfp-document/edit-section.ts` | extend: guidance injection | ⏳ |
| `apps/functions/src/handlers/prompt/save-prompt.ts` | extend: body discrimination | ⏳ |
| `apps/functions/src/handlers/prompt/get-prompts.ts` | extend: `document` group + defaults; drop PROPOSAL | ⏳ |
| `apps/functions/src/handlers/prompt/delete-prompt.ts` | **new**: reset handler | ⏳ |
| `apps/functions/src/handlers/prompt/*.test.ts` | new/extend | ⏳ |
| `packages/infra/api/routes/prompt.routes.ts` | extend: DELETE route | ⏳ |
| `apps/web/lib/hooks/use-prompt.ts` | extend: document group, delete hook | ⏳ |
| `apps/web/lib/prompt/prompt-api.ts` | extend: delete URL | ⏳ |
| `apps/web/components/organizations/PromptManager.tsx` | refactor → tabs container | ⏳ |
| `apps/web/components/organizations/FeaturePromptsTab.tsx` | **new** (extracted; dead types filtered; permission fix) | ⏳ |
| `apps/web/components/organizations/DocumentPromptsTab.tsx` | **new** | ⏳ |
| `apps/web/components/organizations/DocumentPromptRow.tsx` | **new** | ⏳ |
| `apps/web/components/organizations/__tests__/*` | new component tests | ⏳ |

---

## 14. Out of Scope / Follow-ups <!-- ⏳ PENDING -->

- Custom document type prompts (SK design ready: `{orgId}#RFP_DOCUMENT#{customKey}`).
- Reset endpoint for feature prompts (same handler, extend body union).
- Wiring or removing the dead feature types' enum values / DB rows (kept for data compat).
- Gating pricing context / `get_pricing_data` tool by document type (separate security-oriented change discussed during analysis — recommended follow-up).
- Prompt version history / rollback.

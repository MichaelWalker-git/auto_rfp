/**
 * Constants for the AI Compliance Review feature.
 */

// ─── DynamoDB partition keys ────────────────────────────────────────────────

/** Chat messages: SK = {orgId}#{projectId}#{oppId}#{timestamp}#{messageId} */
export const COMPLIANCE_REVIEW_CHAT_PK = 'COMPLIANCE_REVIEW_CHAT';
/** Review runs: SK = {orgId}#{projectId}#{oppId}#{startedAt}#{reviewId} */
export const COMPLIANCE_REVIEW_RUN_PK = 'COMPLIANCE_REVIEW_RUN';
/** Finding decisions (dismiss/resolve): SK = {orgId}#{projectId}#{oppId}#{fingerprint} */
export const COMPLIANCE_FINDING_DECISION_PK = 'COMPLIANCE_FINDING_DECISION';

// ─── Tuning ─────────────────────────────────────────────────────────────────

/**
 * Max agentic tool rounds for the synchronous chat. Bounded to fit the 29s API
 * Gateway limit, but 3 proved too few — broad questions (e.g. "does it meet ALL
 * evaluation criteria?") had the model still gathering at round 3, so it got cut
 * off and returned prose instead of findings. Observed ~2s/round with Haiku, so
 * 5 rounds (~12–15s) leaves comfortable headroom under 29s.
 */
export const MAX_TOOL_ROUNDS = 5;
/**
 * Max agentic tool rounds for the async full-package review. Much higher than
 * the chat: the worker has no 29s limit and must read many documents/forms
 * before it can produce a complete review. Too low and the model gets cut off
 * mid-gather and returns prose instead of the required JSON.
 */
export const MAX_TOOL_ROUNDS_FULL = 12;
/** Max output tokens per model call (synchronous chat — small answers). */
export const MAX_TOKENS = 8000;
/**
 * Max output tokens for the async full review's FINAL JSON. A whole-package
 * review can emit 15–20 detailed findings; at 8000 the single final generation
 * truncated (~30k chars) and the loop's truncate→regenerate-from-scratch retry
 * then blew the Lambda timeout. Budget enough to emit all findings in one shot.
 */
export const MAX_TOKENS_FULL = 24000;
/** Max characters of a single document section returned to the model. */
export const MAX_SECTION_CHARS = 6000;
/**
 * Max fields returned by a single get_form_fields call. A wide XLSX compliance
 * matrix can carry thousands of fields (see the OOM fix in #299); dumping them
 * all unbounded blew the Bedrock 200k-token prompt limit ("prompt is too long:
 * 213494 tokens") on broad questions that made the model read every form. The
 * model can narrow with the tool's labelFilter arg when it needs a specific
 * field (e.g. a phone number).
 */
export const MAX_FORM_FIELDS_RETURNED = 150;
/** Max characters of a single form field's value returned to the model. */
export const MAX_FORM_FIELD_VALUE_CHARS = 200;

// ─── XLSX questionnaire cell inventory ──────────────────────────────────────
//
// XLSX questionnaires (documentType QUESTIONNAIRE, file-based, no htmlContentKey)
// have no persisted grid — their cells are read from the .xlsx in S3 at review
// time so the model can review the answers AND cell anchors can be validated.
// The questionnaire editor renders only the FIRST sheet, so we inventory only
// the first sheet — keeping a validated ("jump works") anchor aligned with what
// the editor can actually navigate to. All limits mirror the form-field caps so
// a large questionnaire can't blow Bedrock's prompt limit.

/** Max rows of the first sheet scanned into the cell inventory. */
export const MAX_QUESTIONNAIRE_ROWS = 500;
/** Max columns of the first sheet scanned into the cell inventory. */
export const MAX_QUESTIONNAIRE_COLS = 50;
/** Max non-empty cells stored per questionnaire (build-time bound). */
export const MAX_QUESTIONNAIRE_CELLS_STORED = 2000;
/** Max non-empty cells returned by a single get_questionnaire_cells call. */
export const MAX_QUESTIONNAIRE_CELLS_RETURNED = 200;
/** Max characters of a single questionnaire cell value returned to the model. */
export const MAX_QUESTIONNAIRE_CELL_VALUE_CHARS = 300;
/**
 * A run left in RUNNING longer than this is treated as FAILED by the read path
 * (crash recovery — the SQS worker died without writing a terminal state).
 * Set above the worker Lambda timeout + SQS retry margin.
 */
export const RUN_STALE_TIMEOUT_MS = 25 * 60 * 1000;

// ─── Missing-forms cross-check (full review only) ───────────────────────────

/**
 * Max characters of merged solicitation text fed to the fresh "expected forms"
 * extraction. The whole solicitation can be hundreds of pages; the required
 * forms/attachments list is almost always named in Section L / the attachments
 * index near the front, so a bounded slice keeps the single extraction call
 * well under Bedrock's prompt limit. Mirrors the detection scan window.
 */
export const MAX_SOLICITATION_CHARS_FOR_FORMS = 150_000;
/** Max output tokens for the "expected forms" extraction (a short name list). */
export const MAX_TOKENS_EXPECTED_FORMS = 2000;
/**
 * Minimum normalized-name length for a substring "already present" match in the
 * missing-forms diff. Below this, containment matches would be trivially true
 * (e.g. "a" in everything) and could mask a genuinely missing form.
 */
export const MISSING_FORM_MIN_MATCH_LEN = 4;

/**
 * Run retention (Option B — TTL + keep-N). Runs accumulate on every re-run, and
 * each carries its full findings[] array, so we bound growth two ways:
 *   - keep only the most recent N runs per opportunity (pruned on create)
 *   - stamp a `ttl` (epoch seconds) so DynamoDB auto-expires stragglers
 * The read path still surfaces only the latest run; the extra retained runs
 * leave room for a future "compare runs" feature without a migration.
 */
export const RUN_KEEP_COUNT = 10;
export const RUN_TTL_DAYS = 90;

// ─── Factual-accuracy review (C1–C5, full review only) ──────────────────────
//
// The factual-accuracy checks follow a two-stage pipeline: cheap deterministic
// candidate generation (high recall) → one batched model verification call per
// check (the precision gate). These bounds keep Stage 2 token-safe even on a
// pathological package, and cap retrieval breadth for the KB/PP checks.

/** Top-K KB (content-library) hits retrieved per document section in C3. */
export const FACTUAL_KB_TOP_K = 3;
/** Top-K usable past-performance records retrieved per candidate reference in C4. */
export const FACTUAL_PP_TOP_K = 3;
/** Max output tokens for a factual-accuracy Stage-2 verification call. */
export const MAX_TOKENS_FACTUAL = 4000;
/**
 * Stage-1 hard cap on candidate spots fed into a single check's Stage-2 model
 * call. A pathological package (thousands of cells, every one a candidate) must
 * not explode the verification prompt; excess candidates are dropped and the
 * drop is logged via the `factual-candidates` instrumentation line.
 */
export const MAX_FACTUAL_CANDIDATES_PER_CHECK = 60;
/** Max characters of a section's text fed to the C3 KB-contradiction verifier. */
export const MAX_FACTUAL_SECTION_CHARS = 3000;

// ─── Solution-plan consistency review (C6, full review only) ────────────────
//
// C6 checks the package against the opportunity's latest READY solution plan:
//   C6a — structured cost schedule (service label + price) vs package (deterministic → verify)
//   C6b — plan prose (approach/team/services) vs package HTML sections (section-chunked → verify)
//   C6c — structured team roster (role → assigned person) vs package (deterministic → verify).
//         The roster is a plan sidecar written AFTER synthesis (NOT in the prose the
//         plan HTML carries), so team consistency needs its own structured check —
//         C6b can only catch team claims that happen to appear in the plan prose.
//   C6d — structured person→role (the transpose of C6c): the SAME plan person listed
//         under a DIFFERENT role vs package (deterministic → verify). C6c keys on the
//         role (wrong person?); C6d keys on the person (wrong role?). A package edit
//         that only relabels an existing person's role trips C6d, never C6c.

/**
 * Max characters of the solution-plan text fed to the C6b prose-contradiction
 * verifier. The plan is loaded pre-truncated to SOLUTION_PLAN_TEXT_BUDGET
 * (~12k); this caps what a single contradiction call carries alongside the
 * package sections so the prompt stays well under Bedrock's limit.
 */
export const MAX_SOLUTION_PLAN_TEXT_CHARS = 8000;

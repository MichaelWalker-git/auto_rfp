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
/**
 * A run left in RUNNING longer than this is treated as FAILED by the read path
 * (crash recovery — the SQS worker died without writing a terminal state).
 * Set above the worker Lambda timeout + SQS retry margin.
 */
export const RUN_STALE_TIMEOUT_MS = 25 * 60 * 1000;

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

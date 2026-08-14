// ─── PK constants ──────────────────────────────────────────────────────────────
export const PACKAGE_EDIT_RUN_PK = 'PACKAGE_EDIT_RUN';
// Separate PK for the per-opportunity "one active run" lock. Kept off the run PK
// so it never appears in run listing/pruning. One item per opportunity (fixed SK)
// enforces mutual exclusion via a conditional write, not a check-then-create.
export const PACKAGE_EDIT_RUN_LOCK_PK = 'PACKAGE_EDIT_RUN_LOCK';

// ─── Tuning (mirror compliance-review constants) ─────────────────────────────────
// The unified chat is a SINGLE agentic loop (review + edit routing in one pass),
// so it uses the same round budget as the compliance chat (proven ~12–15s with
// Haiku, comfortably under the 29s API Gateway limit). It must NOT be run in
// addition to a second review pass — that summed to ~32s and 503'd.
export const MAX_TOOL_ROUNDS_CHAT = 5;
export const MAX_TOOL_ROUNDS_PROPOSE = 12; // full scan (worker)
export const MAX_TOKENS_CHAT = 4000;
export const MAX_TOKENS_PROPOSE = 24000;

// Crash-recovery: a PROPOSING run older than this is presumed dead (> worker
// Lambda 15-min timeout, matching compliance-review's RUN_STALE_TIMEOUT_MS).
export const RUN_STALE_TIMEOUT_MS = 25 * 60 * 1000;

// Retention / pruning (mirror compliance-review).
export const RUN_KEEP_COUNT = 10;
export const RUN_TTL_DAYS = 90;

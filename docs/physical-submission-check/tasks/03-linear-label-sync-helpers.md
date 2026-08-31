# 03 — Linear label sync helpers

**What to build:** Two additive Linear label functions and an orchestrator helper that any caller can invoke to keep the Linear ticket in sync with the detected submission method. When this ticket is done, syncing the physical-submission label to Linear is a single fire-and-forget call, and the functions are covered by tests.

**Blocked by:** 01 — Core schemas and pure helpers (parallelizable with 02)

**Status:** ready-for-agent

- [ ] Add `addLinearLabelByIdentifier(orgId: string, identifier: string, labelName: string): Promise<void>` to `apps/functions/src/helpers/linear.ts`. Follow the `swapLinearGateLabelByIdentifier()` identifier-resolution pattern: resolve the issue by human identifier, fetch its current label set, union in the new label, write the updated set back. Never removes existing labels.
- [ ] Add `removeLinearLabelByIdentifier(orgId: string, identifier: string, labelName: string): Promise<void>` to the same file. Same resolution pattern; removes only the named label, leaving all others intact.
- [ ] Add `syncPhysicalSubmissionLabel(orgId: string, oppId: string, isPhysical: boolean): Promise<void>` — a new helper (can live in `apps/functions/src/helpers/linear.ts` or a co-located `physical-submission-linear.ts`). It checks if `oppId.startsWith('linear-')`, extracts the Linear identifier, then calls `addLinearLabelByIdentifier` when `isPhysical` is true or `removeLinearLabelByIdentifier` when false. No-ops silently for non-Linear opportunities.
- [ ] All three functions are wrapped in try/catch — any Linear API failure logs a warning and does not throw.
- [ ] Co-located test file (new, since `linear.ts` currently has no tests): `apps/functions/src/helpers/linear.test.ts`. Tests: `addLinearLabelByIdentifier` adds label without removing existing ones; `removeLinearLabelByIdentifier` removes only the target label; both catch and swallow API errors; `syncPhysicalSubmissionLabel` calls add when `isPhysical: true`, calls remove when `isPhysical: false`, is a no-op for non-`linear-` oppIds.

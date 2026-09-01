# 04 — Brief worker integration

**What to build:** Wire the scanner and Linear sync into the executive brief pipeline. When this ticket is done, generating or re-generating an executive brief automatically detects physical submission requirements, persists the three fields on the opportunity, auto-fills the FOIA contact address when it is empty, and applies the Linear label — all without ever blocking or failing the brief.

**Blocked by:** 02 — Physical submission scanner, 03 — Linear label sync helpers

**Status:** ready-for-agent

- [ ] In `exec-brief-worker.ts` `runSummary()`, call `scanPhysicalSubmission(rawSolicitationText)` immediately after the existing `scanDeliveryLocationConstraint()` block.
- [ ] If the scanner returns a result, call `updateOpportunity()` to persist `submissionMethod`, `submissionMailingAddress`, and `submissionMethodRationale` on the opportunity. Follow the existing try/catch + conditional update pattern in lines 282–312.
- [ ] If the scanner returns a result with a non-null `submissionMailingAddress` and the opportunity's `foiaContactAddress` is currently null or empty, auto-populate `foiaContactAddress` using `formatFoiaComponentAddress(submissionMailingAddress)`.
- [ ] After a successful detection, call `syncPhysicalSubmissionLabel(orgId, oppId, isPhysicalSubmission(result.submissionMethod))` fire-and-forget (no await needed in the critical path, or awaited inside its own try/catch).
- [ ] A thrown exception from the scanner or the persistence step must be caught and logged — it must never fail the overall brief generation. Follow the same fail-open pattern used for `scanDeliveryLocationConstraint`.
- [ ] Update `apps/functions/src/handlers/brief/exec-brief-worker.test.ts`: verify scanner is called with the raw text; detection result flows to `updateOpportunity`; FOIA field is populated when address is present and `foiaContactAddress` is empty; FOIA field is NOT overwritten when `foiaContactAddress` is already populated; scanner exception does not fail the brief; `syncPhysicalSubmissionLabel` is called with the correct `isPhysical` value.

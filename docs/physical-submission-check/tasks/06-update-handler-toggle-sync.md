# 06 — Opportunity update handler: toggle → Linear sync

**What to build:** When a user manually toggles `submissionMethod` via the existing `PATCH /opportunities` endpoint, the Linear label is kept in sync automatically. When this ticket is done, toggling to PHYSICAL or BOTH adds the label, and toggling to ELECTRONIC or UNKNOWN removes it — without any new API surface.

**Blocked by:** 03 — Linear label sync helpers

**Status:** ready-for-agent

- [ ] In the opportunity update handler (find the handler that processes `PATCH /opportunities`), after a successful `updateOpportunity()` call, check whether the patch payload included a `submissionMethod` field.
- [ ] If `submissionMethod` was patched, call `syncPhysicalSubmissionLabel(orgId, oppId, isPhysicalSubmission(submissionMethod))` fire-and-forget. A Linear API failure must never cause the PATCH to return an error — the opportunity update is already committed.
- [ ] Update the co-located test file for the update handler: verify that patching `submissionMethod` to `PHYSICAL` triggers `syncPhysicalSubmissionLabel` with `isPhysical: true`; patching to `ELECTRONIC` triggers it with `isPhysical: false`; patching a field other than `submissionMethod` does not trigger sync; Linear sync failure does not change the 200 response.

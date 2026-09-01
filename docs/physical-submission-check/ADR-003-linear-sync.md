# ADR-003: Linear Label Sync — Immediate, App-to-Linear Only, Additive

## Status

Accepted

## Context

The AutoRFP system integrates with Linear for RFP tracking. The "Government Contracting" project board in Linear already has a "physical submission" label (referenced in `packages/core/src/schemas/rfp-tracking.ts` line 57). Currently, this label is applied manually by team members.

The existing Linear integration has two patterns:
1. **Linear → App** (read): `sync-linear-pipeline.ts` runs every 15 minutes via EventBridge, mirroring Linear issues into DynamoDB opportunities. Issues that aren't already tracked get `oppId = linear-{identifier}`.
2. **App → Linear** (write): `rfp-linear-writeback.ts` uses `swapLinearGateLabelByIdentifier()` to swap gate labels (Initial Approval → I Approved, etc.) based on approval decisions in the dashboard. Gate labels are mutually exclusive; all other labels (including "physical submission") are preserved during swaps.

The existing write-back only handles gate label swaps. There is no pattern for adding a non-gate label from the app to Linear.

## Decision

### Immediate sync on detection

When physical submission is detected (either during SAM.gov import or exec brief generation), the system immediately calls the Linear API to add the "physical submission" label. No batching or waiting for the 15-minute sync cycle.

The call is fire-and-forget: wrapped in try/catch with a console.warn on failure. A failed Linear label sync never prevents the brief from completing or the opportunity from being updated.

### App-to-Linear direction only

- Detection in app → adds "physical submission" label to Linear ticket
- User toggle ON in app → adds label to Linear
- User toggle OFF in app → removes label from Linear
- Label added/removed directly in Linear → NOT synced back to app

This avoids bidirectional sync complexity. The 15-minute sync (`sync-linear-pipeline.ts`) already preserves non-gate labels (line 57 comment: "all other labels (proposal, genai, physical submission, ...) are preserved"), so the label won't be accidentally removed by the sync.

### New additive label helper

`addLinearLabelByIdentifier(orgId, identifier, labelName)` in `linear.ts`:
- Same identifier-resolution pattern as `swapLinearGateLabelByIdentifier()`
- Resolves the issue by its human identifier (e.g., "HOR-1234")
- Fetches current labels, unions in the new label
- Writes the updated label set back

Unlike `swapLinearGateLabelByIdentifier`, this function only adds — it never removes existing labels. A corresponding `removeLinearLabelByIdentifier()` is also needed for the toggle-OFF case.

### Orchestrator helper

`syncPhysicalSubmissionLabel()` in `physical-submission-linear.ts`:
1. Checks if the opportunity is Linear-synced (`oppId.startsWith('linear-')`)
2. If yes: extracts the Linear identifier, calls `addLinearLabelByIdentifier()`
3. If no: no-op (non-Linear opportunities don't have a ticket to label)

This is called from:
- `exec-brief-worker.ts` → `runSummary()` after physical submission detection
- The opportunity update handler when `submissionMethod` is toggled (for the manual override path)

## Alternatives Considered

### A. Batch during 15-minute sync cycle
Store the detection flag, then during the next sync cycle check for unlabeled physical submissions. **Rejected** because: up to 15 minutes of delay defeats the "early detection" goal. The whole point is to surface this immediately. Also, the sync currently only reads from Linear — adding write logic to it would complicate its single-responsibility design.

### B. Full bidirectional sync
Label added in Linear → synced to app flag, and vice versa. **Rejected** by user decision: adds significant complexity (the sync would need to diff label sets, handle conflicts, track label-change provenance). The unidirectional model is simpler and sufficient — the app is the authoritative source of AI-detected fields, and Linear is the display surface.

### C. Use existing swapLinearGateLabelByIdentifier
Add "physical submission" as a quasi-gate label. **Rejected** because: gate labels are mutually exclusive (a card carries exactly one). "Physical submission" is not a gate — it's an orthogonal attribute that coexists with whatever gate label the card has.

## Consequences

- The "physical submission" label appears on Linear tickets within seconds of detection, not minutes
- Manual toggle in the app also syncs to Linear, keeping the board accurate
- Label changes made directly in Linear are not reflected in the app — the app's `submissionMethod` field is the source of truth
- A new `addLinearLabelByIdentifier()` function is introduced, reusable for future non-gate label automation
- Linear API failures are silently logged — no user-facing error, no brief failure

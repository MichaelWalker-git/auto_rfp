# 01 — Core schemas and pure helpers

**What to build:** Add the shared foundation that every other ticket in this feature imports. When this ticket is done, TypeScript across all packages knows about `SubmissionMethodDetected`, the three new opportunity fields, and the two pure helper functions — and the schema test suite verifies their behaviour.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Add `SubmissionMethodDetectedSchema` (`z.enum(['ELECTRONIC', 'PHYSICAL', 'BOTH', 'UNKNOWN'])`) to `packages/core/src/schemas/opportunity.ts`, exported alongside the existing schemas. Name includes "Detected" to distinguish it from the existing `SubmissionMethodSchema` in `proposal-submission.ts` which describes how a proposal was actually submitted.
- [ ] Add three `.nullish()` fields to `OpportunityItemSchema` after `deliveryConstraintRationale` (~line 392): `submissionMethod` (`SubmissionMethodDetectedSchema.nullish()`), `submissionMailingAddress` (`FoiaComponentAddressSchema.nullish()`), `submissionMethodRationale` (`z.string().max(500).nullish()`).
- [ ] Add `submissionMethod: SubmissionMethodDetectedSchema.nullish()` to `OpportunityListItemSchema` so badges can render on cards without fetching the full opportunity.
- [ ] Export `isPhysicalSubmission(method: SubmissionMethodDetected | null | undefined): boolean` — returns `true` for `PHYSICAL` or `BOTH`, `false` for everything else. Pure function, exported from `packages/core`.
- [ ] Export `computeMailDeadline(responseDeadlineIso: string | null | undefined, transitDays?: number): string | null` — subtracts `transitDays` business days (skipping weekends) from the deadline ISO string, returns an ISO date string or `null` when the input is absent or in the past. Export `DEFAULT_MAIL_TRANSIT_BUSINESS_DAYS = 5` as a constant alongside it.
- [ ] Vitest tests in `packages/core` covering: `isPhysicalSubmission` returns true for PHYSICAL and BOTH, false for ELECTRONIC, UNKNOWN, null, undefined; `computeMailDeadline` correct subtraction for a weekday deadline, a Monday deadline (span crosses weekend), null input returns null.
- [ ] `packages/core` builds cleanly (`pnpm --filter @auto-rfp/core build`) after all changes.

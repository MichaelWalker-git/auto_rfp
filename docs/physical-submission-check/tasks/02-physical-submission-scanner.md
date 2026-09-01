# 02 — Physical submission scanner

**What to build:** A deterministic regex scanner that takes raw solicitation text and returns a structured detection result — submission method enum value, extracted mailing address, and the rationale excerpt. When this ticket is done, the scanner is fully tested in isolation and ready to be wired into the brief worker and SAM.gov import handler.

**Blocked by:** 01 — Core schemas and pure helpers

**Status:** ready-for-agent

- [ ] Add `scanPhysicalSubmission(text: string): { submissionMethod: SubmissionMethodDetected; submissionMailingAddress: FoiaComponentAddress | null; submissionMethodRationale: string | null } | null` to `apps/functions/src/helpers/executive-opportunity-brief.ts`, directly after the existing `scanDeliveryLocationConstraint()` function. Follow its structure exactly.
- [ ] PHYSICAL indicators: phrases such as "mail proposals to", "submit hard copies", "deliver to the following address", "hand-deliver", "USPS", "FedEx", "certified mail", "overnight delivery", "physical copies required", "original plus N copies". Case-insensitive.
- [ ] ELECTRONIC indicators: phrases such as "submit electronically", "electronic submission only", "no hard copies", "no physical copies", "submit via SAM.gov", "submit via email", "submit via portal". Case-insensitive.
- [ ] Result is `PHYSICAL` when only physical indicators match, `ELECTRONIC` when only electronic, `BOTH` when both, `null` (no result) when neither.
- [ ] After detecting `PHYSICAL` or `BOTH`, attempt to extract a US mailing address from the ~500 characters surrounding the match. Return a `FoiaComponentAddressSchema`-shaped object (best-effort; sub-fields may be null if not found).
- [ ] Return the matched snippet (up to 500 chars) as `submissionMethodRationale`.
- [ ] Return `null` (not `{ submissionMethod: 'UNKNOWN' }`) when no indicators are found — the caller is responsible for deciding how to handle absence.
- [ ] Unit tests co-located at `apps/functions/src/helpers/executive-opportunity-brief-sanitize.test.ts` (follow prior art in that file): PHYSICAL-only text, ELECTRONIC-only text, BOTH text, text with no indicators (returns null), address extraction from surrounding text, empty string input, case-insensitivity, mixed-case carrier names.

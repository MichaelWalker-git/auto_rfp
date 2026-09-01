# Physical Submission Check — Glossary

## Terms

### Submission Method
The mechanism an RFP requires for proposal delivery. Detected values:
- **ELECTRONIC** — proposals submitted via email, portal (SAM.gov, eBuy), or other digital means
- **PHYSICAL** — proposals must be mailed or hand-delivered to a physical address
- **BOTH** — solicitation accepts both electronic and physical submission (or requires both)
- **UNKNOWN** — no clear submission method indicator found in the solicitation

### Physical Submission
Any RFP where `submissionMethod` is `PHYSICAL` or `BOTH`. These require the team to account for mail transit time when planning submission deadlines.

### Mail Deadline (Internal Mail Deadline)
A computed date = `responseDeadlineIso` minus `DEFAULT_MAIL_TRANSIT_BUSINESS_DAYS` (default: 5). This is the date by which the proposal package must be mailed to arrive before the RFP response deadline. Calculated at render time, not persisted.

### Transit Days
The number of business days (weekdays, excluding weekends) allocated for mail delivery. Default is 5 business days. Configurable via `DEFAULT_MAIL_TRANSIT_BUSINESS_DAYS` constant in `packages/core`.

### Submission Mailing Address
The structured physical address where proposals must be mailed, extracted from the solicitation text. Stored using the same schema as `FoiaComponentAddressSchema` (addressLine1-3, locality, administrativeArea, postalCode, countryCode).

### Deterministic Scan
A regex-based scan over the full solicitation text that runs before truncation. Provides reliable, deterministic detection for explicit language (e.g., "mail proposals to the following address"). Takes precedence over the LLM's extraction. Pattern established by `scanDeliveryLocationConstraint()`.

### AI Fallback
When the deterministic regex scan returns null (no explicit language found), the LLM's extraction from the executive brief prompt serves as a fallback. Less reliable than regex for unambiguous clauses, but catches subtler or non-standard phrasing.

### Linear Label Sync
The process of adding the "physical submission" label to the opportunity's Linear ticket when physical submission is detected. Direction: app-to-Linear only. The label already exists on the "Government Contracting" project board.

## Existing Terms (referenced but not new)

### `FoiaComponentAddressSchema`
Structured address schema from `packages/core/src/schemas/foia-component.ts`. Fields: addressLine1, addressLine2, addressLine3, locality, administrativeArea, postalCode, countryCode. Includes `formatFoiaComponentAddress()` for rendering to a single-line string.

### `scanDeliveryLocationConstraint()`
Existing deterministic regex scanner in `apps/functions/src/helpers/executive-opportunity-brief.ts` that detects US_ONLY vs OFFSHORE_ALLOWED delivery requirements. The physical submission scanner follows this identical pattern.

### `OpportunityNotaryChip`
Existing badge component in `apps/web/components/opportunities/OpportunityNotaryChip.tsx`. The physical submission badge follows this pattern for consistent card-level indicators.

# 05 — SAM.gov import integration

**What to build:** Run the physical submission scanner at import time so opportunities carry a detection result from the moment they enter the system, before any documents are uploaded or a brief is generated. No Linear sync here — the brief worker is the authoritative path for that.

**Blocked by:** 02 — Physical submission scanner

**Status:** ready-for-agent

- [ ] In `apps/functions/src/handlers/search-opportunity/import-solicitation.ts`, call `scanPhysicalSubmission()` against the SAM.gov description text (and any other available text fields) after the opportunity record is constructed but before it is persisted.
- [ ] If the scanner returns a result, include `submissionMethod`, `submissionMailingAddress`, and `submissionMethodRationale` in the opportunity being stored. If the scanner returns null, leave those fields absent (they are `.nullish()` — no value needed).
- [ ] This scan is supplementary and lightweight — it must not throw or block the import on failure. Wrap in try/catch and log a warning on error.
- [ ] Update `apps/functions/src/handlers/search-opportunity/import-solicitation.test.ts`: verify scan is called during import; when the description contains physical submission language the three fields are stored on the opportunity; when the description has no indicators the opportunity is stored without those fields; a scanner exception does not fail the import.

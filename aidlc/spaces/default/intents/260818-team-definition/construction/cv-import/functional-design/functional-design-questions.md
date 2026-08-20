# Functional Design — cv-import (U2) — Questions

Most of U2's behavior is settled by requirements.md (FR2.x, NFR1/NFR2) and the unit definition. Two genuine gaps remain.

## Q1. On re-import, may extraction overwrite fields a human edited by hand?

Merge is by name (update existing, add new, never delete). The open point is field-level precedence when a record was manually corrected after an earlier import.

A. Manual edits win — re-import updates only fields still carrying AI-imported values; manually edited fields are left untouched
B. Extraction wins — re-import always overwrites extracted fields with the latest CV content
C. Extraction wins but flags — overwrite, and mark the record as changed for review
D. Not yet defined — recommend during design
X. Other (please specify)

[Answer]: A

## Q2. What does the import report treat as a failure worth naming?

A. Two categories — unreadable documents (no text/extraction failed) and detected-CV-but-extraction-incomplete (name missing); everything else counts as success
B. One category — any document that produced no employee is listed, including non-CV documents the AI skipped on purpose
C. Not yet defined — recommend during design
X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- Re-import precedence: manual edits win — only AI-imported field values are updated (Q1: A)
- Failure report: two categories — unreadable documents and incomplete extractions; skipped non-CVs are not failures (Q2: A)

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct

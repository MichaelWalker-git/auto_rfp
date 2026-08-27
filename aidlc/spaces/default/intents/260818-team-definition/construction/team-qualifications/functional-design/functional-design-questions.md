# Functional Design — team-qualifications (U4) — Questions

Most of U4's behavior is settled by requirements.md (FR4.x) and the unit definition. Two genuine gaps remain.

## Q1. What employee content does TEAM_QUALIFICATIONS cite per person?

The employee record holds structured fields (name, roles, certifications, location) plus a résumé/bio reference pointing at the source CV document.

A. Structured fields plus the referenced CV's text — generation retrieves each member's CV content for richer bios (matches the existing prompts' demand for "actual names and bios")
B. Structured fields only — name, roles, certifications, location; no CV text retrieval
C. Not yet defined — recommend during design
X. Other (please specify)

[Answer]: A

## Q2. How does generation treat non-standard team lines (unfilled positions, removed employees)?

A. Unfilled positions are listed as open roles without personnel claims; removed-employee lines cite the snapshot (name/role) but no qualifications beyond it, marked as pending replacement
B. Both are excluded from the document — only currently filled lines with live employees are cited
C. Not yet defined — recommend during design
X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

- Cited content: structured fields plus the referenced CV's text for richer bios (Q1: A)
- Edge lines: unfilled positions listed as open roles; removed-employee lines cite the snapshot only, marked pending replacement (Q2: A)

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct

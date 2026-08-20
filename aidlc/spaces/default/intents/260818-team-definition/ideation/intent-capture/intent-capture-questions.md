# Intent Capture & Framing — Questions

## Sources

- [desc] Initial description: "@\"docs/team defenition/task\" \nI need to implement this feature\nIt should be separate page in ui on org level, where user will be able to manage emplyee with specified roles(each can have several roles, primary roles and secondary roles), it should be button for generating this employee list by ai from the cvs ( we have cv`s of all our team members in org documents )\nsolution plan should include personel data ( now only roles ) and team qualification document too\nin solution plan ui it should be button to modify the team where user can change team(specified persons or roles) that generated in solution plan"
- [scope] Workflow-selected scope: `team-definition`.

## Q1. What business problem is this feature solving?

The task doc frames it as: RFPs ask for named key personnel with bios and certifications, but today a "Team Definition" is only abstract roles with rates — there is no personnel data in the system, which is also why TEAM_QUALIFICATIONS document generation fails.

A. Exactly that — RFP responses need named personnel with real qualifications, and TEAM_QUALIFICATIONS generation is blocked without them
B. Broader — the org also needs general employee/staff management beyond RFP responses (HR-style directory)
C. Narrower — only fix TEAM_QUALIFICATIONS generation; the employee page is just the means to that end
D. Not yet defined
X. Other (please specify)

[Answer]: B

## Q2. Who is the primary user of this feature, and what pain are they experiencing?

A. Proposal managers / BD staff (internal) — they cannot produce credible personnel sections in proposals without manually digging through CVs
B. Organization admins (internal) — they need to maintain the employee pool and roles as reference data
C. Both A and B — admins maintain the pool, proposal managers consume it in solution plans
D. Not yet defined
X. Other (please specify)

[Answer]: C

## Q3. What does success look like? What measurable outcomes matter?

A. Opening the team section of a solution plan shows a proposed team with roles, and the TEAM_QUALIFICATIONS document generates successfully citing real employee data
B. The org-level employee page is populated (via AI CV extraction) and kept current with minimal manual effort
C. Both A and B — pool populated from CVs AND solution plans/documents consume it end-to-end
D. Not yet defined
X. Other (please specify)

[Answer]: C

## Q4. What is the trigger for doing this now?

A. TEAM_QUALIFICATIONS generation currently fails — a known gap (the task doc calls it the structure half of KB gap D4)
B. Customer/RFP pressure — solicitations increasingly demand named key personnel and the current output is not credible
C. Both A and B
D. Not yet defined
X. Other (please specify)

[Answer]: B

## Q5. Who are the key stakeholders and what does each care about?

A. Product owner (feature value) + proposal managers (usable teams in solution plans) + org admins (accurate employee data)
B. Just the requesting team — this is an internal capability with no wider stakeholder set
C. Also end customers/agencies reviewing proposals — the generated qualification documents are customer-facing
D. Not identified
X. Other (please specify)

[Answer]: D

## Q6. Who decides scope and priority for this feature, and who influences those decisions?

A. You (the requester) decide; the development team influences technical shape
B. A product owner / manager decides; you influence
C. Team consensus — decisions are shared
D. Not identified
X. Other (please specify)

[Answer]: A

## Q7. Are there communication requirements or a reporting cadence for this initiative?

A. None — approvals at the workflow gates are sufficient
B. Regular progress updates needed (e.g., PR descriptions, standup notes)
C. A stakeholder demo is expected when it ships
D. Not applicable
X. Other (please specify)

[Answer]: B

## Q8. The workflow was started with the tailored `team-definition` plan. Your prompt and the task doc frame the product boundary slightly differently — which boundary is intended?

Your prompt centers on: an org-level employee management page (multi-role, primary/secondary), AI generation of the list from CVs in org documents, personnel data (roles only for now) + team qualification document in the solution plan, and a "modify team" flow in the solution plan UI. The task doc adds: an opportunity-level recommended team with match rationale (matching résumés to required certs/skills like past-performance matching).

A. Confirm my prompt's boundary — org-level employee pool + AI CV extraction + solution-plan integration (roles + team qualification doc) + modify-team flow; AI-recommended matching with rationale is included only as the generation behind the solution-plan team
B. Broader — additionally include the full opportunity-level Team Definition view with per-person match rationale as described in the task doc
C. Narrower — only the org-level employee page and AI CV extraction this time; solution-plan integration comes later
D. Not yet defined — let's decide at scope definition
X. Other (please specify)

[Answer]: X.  A - completely, B - Team Definition should be a part of the solution plan, but with posibility to modify it.

## Q9. Follow-up on Q8: the task doc's Team Definition view shows each recommended person with match rationale (why they fit — matching certs/skills). Now that the Team Definition lives inside the solution plan, should that per-person match rationale be visible there too?

A. Yes — the solution-plan team section shows each recommended person with their match rationale
B. No — show only the team (people + roles); the rationale stays internal to the AI generation
C. On demand — rationale available as expandable detail, not in the primary view
D. Not yet defined — decide at scope definition
X. Other (please specify)

[Answer]: A

## Assumption Confirmation

The generated artifacts carry these assumptions:

- The broader stakeholder set (beyond the requester, org admins, proposal managers, and the development team) is not identified yet; the intent proceeds with the requester as sole decision-maker until stakeholders are named.
- "Personnel data (now only roles)" is read as: the solution plan's personnel section displays roles for now, while richer personnel fields may exist in the employee pool itself; the exact employee record fields are to be settled during requirements.

A. Accept assumptions
B. Convert to follow-up questions

[Answer]: B. Convert to follow-up questions

## Q10. Who else, beyond you (deciding), the org admins and proposal managers (using), and the development team (influencing), has a stake in this feature?

A. No one else — the stakeholder set above is complete
B. A product owner / manager who should be kept in the loop
C. End customers/agencies reviewing proposals — the generated qualification documents are customer-facing and their expectations matter
D. Both B and C
X. Other (please specify)

[Answer]: B

## Q11. What should an employee record hold, beyond the multiple primary/secondary roles?

The task doc suggests: name, role(s), certifications, résumé/bio reference, location (on/offshore).

A. Exactly the task doc's set — name, roles, certifications, résumé/bio reference, on/offshore location
B. Minimal for now — name + roles only; extend later
C. The task doc's set plus more (please specify what in Other)
D. Not yet defined — settle during requirements analysis
X. Other (please specify)

[Answer]: A

## Consolidated Summary Confirmation

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct

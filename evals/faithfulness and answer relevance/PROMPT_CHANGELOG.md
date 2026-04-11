# Faithfulness Eval — Prompt Changelog

Tracks every prompt change and its eval results to prevent regressions and understand what works.

---

## Baseline (before this session)

**Prompt version**: Production-style guardrails applied (previous session)
**Result**: 20/29 passed (68.97%)
**Regressions from prior baseline (15/29)**: Tests #6, #10, #28 regressed

| Test # | Question (truncated) | Result | Score | Notes |
|--------|----------------------|--------|-------|-------|
| 6 | Provide an organizational chart... | FAIL | — | Empty output → grader scored 0.0 |
| 10 | What is your experience supporting federal civilian agencies with cloud migration? | FAIL | — | Over-confident claims, generalization from 1 project |
| 28 | Describe your DevOps practices... | FAIL | — | Empty output → grader scored 0.0 |

---

## Run 1 — Fix empty-output + add anti-generalization (v1)

**Date**: 2026-04-08
**Changes to system prompt**:
1. No-context instruction: "return an empty string" → "respond with a brief, factual statement that the provided context does not contain sufficient information"
2. Added anti-generalization rule: "Do NOT generalize a single example into broad capability claims"

**Changes to user prompt**:
3. Step 1: "STOP and return an empty answer" → "STOP and state that the context does not contain relevant information"
4. Step 3: Added "Do not generalize from a single example"
5. Reminder: "return an empty answer" → "state that the context lacks relevant information"
6. Final line: "return empty if no relevant context" → "state that the context lacks relevant information if none exists"

**Result**: 21/29 passed (72.41%) — **+1 net gain**

| Test # | Question (truncated) | Result | Score | Notes |
|--------|----------------------|--------|-------|-------|
| 6 | Provide an organizational chart... | **PASS** | 1.0 | Fixed — now outputs "insufficient info" statement |
| 11 | Federal civilian agencies cloud migration | **FAIL** | 0.84 | Improved but still says "significant federal civilian agency experience" |
| 28 | Describe your DevOps practices... | **PASS** | 0.96 | Fixed — now outputs "insufficient info" statement |

**Other failures (8 total)**:
| Test # | Score | Question (truncated) |
|--------|-------|----------------------|
| 3 | 0.90 | Data migration tools and technologies |
| 4 | 0.89 | Integration with agency's existing infrastructure |
| 5 | 0.33 | Project management methodology |
| 7 | 0.67 | Knowledge transfer during transition-in |
| 10 | 0.87 | Significant technical challenge |
| 11 | 0.84 | Federal civilian agencies cloud migration |
| 22 | 0.50 | Key personnel for infrastructure |
| 27 | 0.81 | Post-deployment support |
| 29 | 0.50 | References with contact information |

---

## Run 2 — Stronger anti-generalization (v2)

**Date**: 2026-04-08
**Changes to system prompt**:
1. Strengthened anti-generalization: "SCOPE CLAIMS TO EVIDENCE: If the context mentions one project, say 'we completed one project' — never 'significant experience'..."
2. Added to FORBIDDEN list: "significant experience", "proven track record", "extensive experience", "demonstrated ability", "proven experience"
3. Added to FORBIDDEN list: "Extrapolating capabilities beyond what a specific project actually delivered"

**Changes to user prompt**:
4. Step 3: Expanded generalization rule + added "If the question asks about capability X but the context only shows capability Y, acknowledge what Y demonstrates without claiming X"
5. BANNED PHRASES: Added "significant experience", "proven track record", "extensive experience", "demonstrated ability", "proven experience"

**Result**: 10/29 passed (34.5%) — context-faithfulness only

**Note**: Run 2 results are from the combined eval (all 4 providers run together). The eval_v2 provider corresponds to this prompt version.

| Test # | Question (truncated) | Result | Faithfulness | Notes |
|--------|----------------------|--------|-------------|-------|
| 3 | Data migration tools and technologies | **PASS** | 0.94 | Improved from 0.90 |
| 8 | Risk identification and mitigation | **PASS** | 1.00 | New pass |
| 9 | Three examples of contracts | **PASS** | 0.91 | New pass |
| 15 | Handle sensitive data / federal security | **PASS** | 1.00 | New pass |
| 17 | Organization certifications | **PASS** | 0.93 | Maintained |
| 18 | Cloud environments and AWS services | **PASS** | 1.00 | Maintained |
| 21 | Automated document classification | **PASS** | 0.94 | New pass |
| 25 | Company overview / legal name | **PASS** | 1.00 | New pass |
| 26 | AI and machine learning capabilities | **PASS** | 0.95 | New pass |

**Failures (19 total)**:
| Test # | Faithfulness | Question (truncated) |
|--------|-------------|----------------------|
| 1 | 0.67 | Technical approach to requirements |
| 2 | 0.58 | 99.9% system uptime |
| 4 | 0.00 | Integration with agency infrastructure |
| 5 | 0.00 | Project management methodology |
| 6 | 0.80 | Organizational chart / key personnel |
| 7 | 0.00 | Knowledge transfer during transition-in |
| 10 | 0.67 | Significant technical challenge |
| 11 | 0.86 | Federal civilian agencies cloud migration |
| 12 | 0.88 | Pricing methodology |
| 13 | 0.93 | Labor categories and hourly rates |
| 14 | 0.82 | Security requirements compliance |
| 16 | 0.33 | Key personnel qualifications/certifications |
| 19 | 0.77 | Document processing / compliance project |
| 20 | — | Loan processing / financial services (error) |
| 22 | 0.50 | Key personnel for infrastructure |
| 23 | 0.25 | Key personnel for backend development |
| 24 | 0.75 | AWS certified key personnel |
| 27 | 0.89 | Post-deployment support |
| 28 | 0.33 | DevOps practices |
| 29 | 0.50 | References with contact information |

---

## Run 3 — Citation requirement + evidence inventory + partial answers + claim-scope + negative example (v4)

**Date**: 2026-04-08
**Provider file**: `generate-v4.ts` / `generate-v4.mjs`

**Changes to system prompt** (6 new sections):
1. **CITATION REQUIREMENT**: Every factual claim must include inline citation [KB-N], [PP-N], [CL-N], or [ORG]. No citation = delete the claim. Added to FORBIDDEN list: "Writing ANY factual claim without an inline citation"
2. **CLAIM-SCOPE MATCHING**: Anti-embellishment rules — 1 project → "one project" not "projects"; 1 tech mention → "used [tech] on [project]" not "expertise in"; metrics cited EXACTLY as written; past tense for what was done, not present tense implying general capability
3. **PARTIAL ANSWERS PREFERRED**: Explicitly allow and encourage partial answers. "Our available records do not include [specific gap]" framing. Partial grounded answer > complete-sounding fabricated answer
4. **EXAMPLE — WRONG vs RIGHT**: Concrete negative example showing fabricated 5-phase methodology vs faithful single-fact answer with citation
5. **Temperature**: Set to 0 (was unset/default) for maximum faithfulness
6. Added "expertise in", "proficient with", "comprehensive approach", "robust methodology" to BANNED PHRASES

**Changes to user prompt**:
7. Step 2 replaced with **EVIDENCE INVENTORY** — model must enumerate citable facts with source tags before writing. If inventory is empty → return insufficient info
8. Step 3 rewritten: every factual sentence must include inline citation; sentences without inventory items must be deleted
9. Added past-tense rule: "Describe what was DONE, not general capabilities"
10. Added "expertise in", "proficient with", "comprehensive approach", "robust methodology" to BANNED PHRASES

**Targets**: Tests #3 (0.90), #4 (0.89), #5 (0.33), #7 (0.67), #10 (0.87), #11 (0.84), #22 (0.50), #27 (0.81), #29 (0.50)
- Citations should flip embellishment failures (#3, #4, #10, #11, #27) from 0.81-0.90 → pass
- Partial answer framing should fix gap-filling failures (#5, #7, #22) from 0.33-0.67 → pass
- Citation + claim-scope should fix fabrication (#29) from 0.50 → pass

**Result**: 16/29 passed (55.2%) — **best provider across all runs**

| Test # | Question (truncated) | Result | Faithfulness | Notes |
|--------|----------------------|--------|-------------|-------|
| 3 | Data migration tools and technologies | **PASS** | 1.00 | Improved from 0.94 (v2) |
| 6 | Organizational chart / key personnel | **PASS** | 0.92 | Fixed — was failing in v2/v3 |
| 10 | Significant technical challenge | **PASS** | 1.00 | Fixed — was 0.67 in v2 |
| 12 | Pricing methodology | **PASS** | 0.95 | Fixed — was 0.88 in v2 |
| 14 | Security requirements compliance | **PASS** | 1.00 | Fixed — was 0.82 in v2 |
| 15 | Handle sensitive data / federal security | **PASS** | 1.00 | Maintained |
| 17 | Organization certifications | **PASS** | 0.92 | Maintained |
| 18 | Cloud environments and AWS services | **PASS** | 0.96 | Maintained |
| 19 | Document processing / compliance project | **PASS** | 0.95 | Fixed — was 0.77 in v2 |
| 20 | Loan processing / financial services | **PASS** | 1.00 | Fixed — was error in v2 |
| 21 | Automated document classification | **PASS** | 0.95 | Maintained |
| 23 | Key personnel for backend development | **PASS** | 1.00 | Fixed — was 0.25 in v2 |
| 24 | AWS certified key personnel | **PASS** | 0.94 | Fixed — was 0.75 in v2 |
| 25 | Company overview / legal name | **PASS** | 0.91 | Maintained |
| 26 | AI and machine learning capabilities | **PASS** | 0.94 | Maintained |
| 28 | DevOps practices | **PASS** | 1.00 | Fixed — was 0.33 in v2 |

**Remaining failures (13 total)**:
| Test # | Faithfulness | Question (truncated) |
|--------|-------------|----------------------|
| 1 | 0.75 | Technical approach to requirements |
| 2 | 0.82 | 99.9% system uptime |
| 4 | 0.60 | Integration with agency infrastructure |
| 5 | 0.50 | Project management methodology |
| 7 | 0.00 | Knowledge transfer during transition-in |
| 8 | 0.80 | Risk identification and mitigation |
| 9 | 0.50 | Three examples of contracts |
| 11 | 0.88 | Federal civilian agencies cloud migration |
| 13 | 0.94 | Labor categories and hourly rates |
| 16 | 0.80 | Key personnel qualifications/certifications |
| 22 | 0.78 | Key personnel for infrastructure |
| 27 | 0.75 | Post-deployment support |
| 29 | 0.50 | References with contact information |

---

## Run 3 — Eval config fix: replace answer-relevance with custom rubric

**Date**: 2026-04-08
**Change**: Replaced generic `answer-relevance` assertion (threshold 0.7) in `defaultTest` with a custom `llm-rubric` that rewards faithful refusals and partial answers instead of penalizing them.

**Rationale**: The `answer-relevance` metric was penalizing correct behavior — when the model faithfully refused to answer due to insufficient context, the relevance grader scored it low. This made all providers appear to fail (0-4/29) even though faithfulness was improving.

**Impact on reported scores** (eval_v4):
- Old grading: 2/29 (6.9%)
- New grading: 16/29 (55.2%)
- The underlying model outputs are identical — only the scoring changed.

**Custom rubric pass rate**: 95.6% across all providers (43/45), confirming the rubric correctly accepts both grounded answers and faithful refusals.

---

## Summary — All Runs Comparison

| Run | Provider | Passed | Rate | Key change |
|-----|----------|--------|------|------------|
| Baseline | (single provider) | 20/29 | 68.9% | Production guardrails |
| Run 1 | (single provider) | 21/29 | 72.4% | Anti-generalization v1 |
| Run 2 | eval_v2 | 10/29 | 34.5% | Stronger anti-generalization |
| Run 2 | eval_v3 | 13/29 | 44.8% | — |
| Run 3 | **eval_v4** | **16/29** | **55.2%** | Citations + evidence inventory |
| Run 3 | eval_v3 | 13/29 | 44.8% | — |
| Run 3 | eval_v2 | 10/29 | 34.5% | — |
| Run 3 | base_prompt | 10/29 | 34.5% | — |

**Note**: Baseline and Run 1 used a different eval config (single provider, possibly different grading model). Direct comparison with Runs 2-3 should account for eval-to-eval variance.

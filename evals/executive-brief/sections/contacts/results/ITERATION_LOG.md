# Contacts Section — Eval Iteration Log

## v1 (2025-04-17 21:56) — Initial run with 5 new test cases
**Result: 6/8 passed**

| Test | Status | Failed Assertions |
|------|--------|-------------------|
| T1 DC Courts | FAIL | HallucinationDetection (score=1, LLM grader flagged Anne B. Wicks + Louis W. Parker as fabricated) |
| T2 DOT Airline | PASS | — |
| T3 FUSRAP | PASS | — |
| T4 DoD COMET | FAIL | HallucinationDetection (score=3, LLM grader flagged @coe.ic.gov emails as fabricated) |
| T5 Sacramento AI | PASS | — |
| T6 BIE Backup | PASS | — |
| T7 IHS Cloud | PASS | — |
| T8 VA Destruction | PASS | — |

**Root causes:**
- T1: LLM grader didn't know Anne B. Wicks and Louis W. Parker are real names in the DC Courts document. Rubric only listed 3 contacts + IPP helpdesk, so grader scored extra contacts as hallucinations.
- T4: LLM grader didn't know about JWICS classified email addresses (@coe.ic.gov) that appear in the solicitation for both contacts. Rubric only listed @dodiis.mil addresses.

---

## v2 (2025-04-17 22:00) — Fix rubric gold standards for T1 and T4
**Result: 8/8 passed**

| Test | Status | Failed Assertions |
|------|--------|-------------------|
| T1 DC Courts | PASS | — |
| T2 DOT Airline | PASS | — |
| T3 FUSRAP | PASS | — |
| T4 DoD COMET | PASS | — |
| T5 Sacramento AI | PASS | — |
| T6 BIE Backup | PASS | — |
| T7 IHS Cloud | PASS | — |
| T8 VA Destruction | PASS | — |

**Changes made:**
- T1 HallucinationDetection rubric: Added Anne B. Wicks (Executive Officer) and Louis W. Parker (Administrative Officer) to REAL CONTACTS list
- T4 HallucinationDetection rubric: Added @coe.ic.gov JWICS classified email addresses for both contacts, and listed MISSILE & SPACE INTELLIGENCE CENTER as valid organization

**SECTION COMPLETE: Contacts eval passes 8/8**

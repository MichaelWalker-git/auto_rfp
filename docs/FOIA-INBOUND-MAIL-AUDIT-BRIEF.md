# FOIA inbound mail — audit brief for a fresh agent

> **Task:** audit every message the FOIA inbound pipeline has ingested and report what it
> got **wrong**. Read-only. Do not change code, do not deploy, do not modify DynamoDB.
>
> **Written:** 2026-08-17. Numbers below were measured that day; re-measure, don't trust them.

---

## Why this audit exists

Every fixture in this feature was written by the same person who wrote the code, so the
tests agree with the author's assumptions rather than with reality. Real mail has
already corrected the classifier **five separate times** — each time the unit suite was
green and the behaviour was still wrong:

1. `receipt.recipients` (SMTP envelope) vs `mail.destination` (headers) — forwarded mail
   was silently dropped because the test fixtures put our address in `destination`.
2. `"Award(s) Published"` classified `UNRELATED` — `(s)` is a literal, so `\baward(ed)?\b`
   cannot match it.
3. A California reply that attached a contractor ranking, a notice of selection and a
   competitor's proposal was labelled `DENIED`, because a bare `withheld` pattern matched
   **our own quoted request letter** in the forwarded thread.
4. `awardDateFromMail` stamped its receipt-date fallback `RECORDED_AWARD` — verified
   provenance — laundering "the day this email reached us" into an asserted award date
   that would also have satisfied the unattended-send gate.
5. The award date was written to `opportunity.outcomeDate` with the provenance discarded,
   so `resolveAwardDate` re-labelled it verified on read.

**The failure mode to hunt is a WRONG classification or a WRONG correlation — not a
missing one.** An `UNRELATED` that should have been an award notice costs a filing. An
award notice attached to the *wrong opportunity* corrupts a statutory letter.

---

## Current state (measured 2026-08-17 — verify)

| Metric | Value |
|---|---|
| Objects in the mail bucket | 109 |
| Rows in the `FOIA_MAIL_SCAN` ledger | 94 |
| Correlated to an opportunity | 6 |
| All ingested under org | `9c0a5757…` (HORUSTECH) |

Classification split:

| Classification | Count | Action taken |
|---|---|---|
| `UNRELATED` | 62 | `IGNORED` × 62 |
| `OUR_OWN_REQUEST` | 17 | `OWN_REQUEST_LOGGED` × 17 |
| `AWARD_NOTICE` | 9 | `AWARD_RECORDED` × 3, rest `FLAGGED_FOR_REVIEW` |
| `FOIA_RESPONSE` | 4 | `FLAGGED_FOR_REVIEW` |
| `SOLICITATION_CANCELLED` | 2 | `FLAGGED_FOR_REVIEW` |

**Note the gap: 109 objects vs 94 ledger rows.** ~15 messages are in S3 with no ledger
row. Explaining that gap is part of the task — it could be benign (a redelivery deduped
on `Message-ID`, a non-mail object) or it could be silent ingestion failures.

---

## Access

```bash
aws sso login --profile horus-dev          # token expires ~hourly; re-run when calls fail
export AWS_PROFILE=horus-dev
```

Account `039885961427`. **Two regions, and this trips people up:**

| Resource | Region |
|---|---|
| SES receipt rule, mail S3 bucket, inbound Lambda | **us-west-2** |
| DynamoDB table, everything else | **us-east-1** |

us-east-1 already had an active SES receipt rule set belonging to another project, and
AWS permits only one per region — hence the split. The Lambda runs in us-west-2 and
writes cross-region to the us-east-1 table.

```
Lambda   auto-rfp-foia-inbound-Dev        (us-west-2)
Bucket   auto-rfp-foia-inbound-dev-039885961427   (us-west-2, prefix inbound/)
Table    RFP-table-Dev                    (us-east-1)
Mailbox  configured per-org as foiaSettings.scrapeMailbox
```

### Reading the ledger

```bash
aws dynamodb query --table-name RFP-table-Dev --region us-east-1 --no-cli-pager \
  --key-condition-expression "partition_key = :pk" \
  --expression-attribute-values '{":pk":{"S":"FOIA_MAIL_SCAN"}}' \
  --output json
```

Ledger rows store: `messageId`, `classification`, `action`, `orgId`, `oppId`,
`receivedAt`, `ttl`. **They do NOT store the subject or sender** — so to judge whether a
classification was correct you must fetch the raw MIME from S3 and read it. That is the
core of the work.

```bash
aws s3 ls s3://auto-rfp-foia-inbound-dev-039885961427/inbound/ --region us-west-2
aws s3 cp s3://auto-rfp-foia-inbound-dev-039885961427/inbound/<key> - --region us-west-2 | head -60
```

The S3 object key is **not** the `Message-ID`. Correlating a bucket object to its ledger
row means parsing the `Message-ID` header out of the raw MIME.

---

## The code under audit

| File | Role |
|---|---|
| `apps/functions/src/handlers/foia/process-inbound-mail.ts` | SES → S3 → classify → act. Start here. |
| `apps/functions/src/helpers/foia-mail-parse.ts` | MIME parsing, headers, attachments |
| `apps/functions/src/helpers/foia-mail-classify.ts` | `classifyMailDeterministic` — the 5-way decision |
| `apps/functions/src/helpers/foia-mail-correlate.ts` | Matches a message to an opportunity |
| `apps/functions/src/helpers/foia-mail-ingest.ts` | `readResponseOutcome`, `awardDateFromMail` |

Classifications: `AWARD_NOTICE`, `SOLICITATION_CANCELLED`, `FOIA_RESPONSE`,
`OUR_OWN_REQUEST`, `UNRELATED`.
Response outcomes: `RECORDS_RECEIVED`, `NO_RECORDS_LOCATED`, `DENIED`, `ACKNOWLEDGED`.

**No AI/LLM anywhere in this pipeline** — it is regex patterns, keyword weights and
static maps, deliberately. Do not propose replacing it with a model; do propose specific
patterns for phrasings it misses.

---

## What to produce

### 1. A table of every message

One row per message: S3 key (short), date, sender, subject, classification, action,
correlated `oppId`, and **your independent judgement** of whether that classification is
right. Read the actual body — a subject line alone is not enough, especially for
forwarded threads where our own quoted letter appears below the agency's reply.

### 2. Every disagreement, with evidence

For each message you believe was classified or correlated wrongly:

- what it was classified as, and what it should have been
- the quoted text that proves it
- **which specific pattern** in `foia-mail-classify.ts` failed, and why
- the consequence: a missed filing? a wrong award date? a corrupted letter?

Prioritise by consequence, not by count. A single wrong correlation matters more than
twenty `UNRELATED` newsletters.

### 3. Specific attention

- **The 62 `UNRELATED`.** Are any actually award notices, cancellations, or agency
  replies? BidNet/HigherGov digest emails are legitimately unrelated; an
  agency-to-us reply is not.
- **The 9 `AWARD_NOTICE` where only 3 recorded a date.** Why did 6 flag for review
  instead? Missing parseable date, ambiguous correlation, or something else?
- **The 6 correlations.** Each one — is it the right opportunity? Check the solicitation
  number matching for false positives on short or shared-prefix numbers.
- **The 17 `OUR_OWN_REQUEST`.** Our own outgoing letters must never be mistaken for an
  agency `FOIA_RESPONSE` — that regression has happened before.
- **The 109-vs-94 gap.** Which S3 objects have no ledger row, and why?
- **Award-date provenance.** For anything that recorded a date: is it the agency's stated
  date (`RECORDED_AWARD`), or our receipt date (`RECORDED_OUTCOME`)? The second must
  never be written to `opportunity.outcomeDate` — see `process-inbound-mail.ts` around
  the `provenance === 'RECORDED_AWARD'` guard.

### 4. Reproduction, not just observation

For each real defect, add a failing test case to the co-located test file using the
**real** subject/body text as a fixture, and confirm it fails against current code. Do
not fix the code — the point of this pass is an evidence-backed defect list. A claim
without a failing test is a hypothesis.

Jest 30: the flag is `--testPathPatterns` (**plural**). The singular form silently
matches nothing and reports success.

```bash
cd apps/functions && npx jest --testPathPatterns='foia-mail'
```

---

## Rules

- **Read-only on AWS.** No `put-item`, `update-item`, `delete-object`, no deploys.
  Reading S3 and querying DynamoDB is fine.
- **Do not modify the classifier.** Report defects; a separate pass fixes them.
- **Never paste a credential, token, or API key into the report.**
- Messages are real customer correspondence. Quote only what is needed to prove a point.
- If a number here disagrees with what you measure, **trust your measurement** and say so.

## Context that changes conclusions

- **Nothing has ever been transmitted to a real agency.** `autoSendTrusted` is false and
  every prepared request rests at `AWAITING_APPROVAL`. So a wrong classification has not
  yet caused a wrong filing — it is still latent. That makes this audit cheap and worth
  doing now.
- `FLAGGED_FOR_REVIEW` is the designed outcome for anything ambiguous, not a failure.
  The pipeline is meant to refuse rather than guess.
- The two `SOLICITATION_CANCELLED` messages flagged for review rather than applying
  `SUPPRESSED`, which is why the dashboard's Cancelled bucket is empty for HORUSTECH.
  Worth confirming that is intended and not a broken transition.

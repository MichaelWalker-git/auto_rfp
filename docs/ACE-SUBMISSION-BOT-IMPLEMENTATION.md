# ACE Submission Bot — Auto-Advance to Technical Validation <!-- ✅ IMPLEMENTED -->

> Asynchronous bot that takes an AWS Partner Central (ACE) opportunity from
> creation all the way to **Technical Validation**, driving the multi-step,
> hours-to-days AWS review lifecycle without a human babysitting it.

---

## 1. Why a bot (and not one API call)

AWS Partner Central does **not** let you set an opportunity's stage to
`Technical Validation` directly. The platform enforces this sequence:

1. `CreateOpportunity` always lands at **Stage = Prospect**, `ReviewStatus = "Pending Submission"`.
2. `UpdateOpportunity` **cannot** change the stage while it is `Pending Submission`.
3. You must `StartEngagementFromOpportunityTask` (create the engagement), then
   `SubmitOpportunity` to enter **AWS review**.
4. AWS review is **asynchronous** — it can take **hours to days**, and it can be
   **Rejected** or come back **Action Required**.
5. Only once `ReviewStatus = "Approved"` does the stage become editable, so
   `UpdateOpportunity` can finally advance it to `Technical Validation`.

Because step 4 is async and open-ended, there is no synchronous call that does
"submit and advance." The bot is therefore a **state machine persisted per
opportunity** plus a **scheduled poller** that takes exactly one idempotent step
per tick.

---

## 2. State machine

Each opportunity carries an `aceSubmission` sub-record. The poller reads its
`state` and performs the single next action:

```
NONE
  └─ startAceSubmission ─▶ StartEngagementFromOpportunityTask
ENGAGEMENT_PENDING ── poll task ──▶ COMPLETE ▶ ENGAGED      (FAILED ▶ FAILED)
ENGAGED            ── SubmitOpportunity ─────▶ SUBMITTED
SUBMITTED/IN_REVIEW ─ poll ReviewStatus ────▶ IN_REVIEW / ACTION_REQUIRED
                                              / APPROVED / REJECTED
APPROVED           ── UpdateOpportunity ─────▶ ADVANCED  (local ACE stage set too)
ADVANCED | REJECTED | FAILED                    terminal
ACTION_REQUIRED                                 paused (surfaced for a human)
```

| State | Meaning | Poller action |
|---|---|---|
| `NONE` | Not started | Fire `StartEngagementFromOpportunityTask` |
| `ENGAGEMENT_PENDING` | Engagement task running | Poll task; re-fire if the TaskId was lost |
| `ENGAGED` | Engagement complete | `SubmitOpportunity` → AWS review |
| `SUBMITTED` / `IN_REVIEW` | Awaiting AWS reviewers | Poll `ReviewStatus` |
| `ACTION_REQUIRED` | AWS needs changes | **Paused** — human intervention required |
| `APPROVED` | AWS approved | `UpdateOpportunity` → stage `Technical Validation` |
| `ADVANCED` | Done | Terminal |
| `REJECTED` | AWS rejected | Terminal |
| `FAILED` | Engagement task failed | Terminal |

**Terminal states** (`ADVANCED`, `REJECTED`, `FAILED`) and the **paused** state
(`ACTION_REQUIRED`) are skipped by the poller — no further automated work.

---

## 3. Files

| File | Role |
|---|---|
| `packages/core/src/schemas/apn.ts` | `AceSubmissionStateSchema`, `AceSubmissionSchema`, `ACE_SUBMISSION_TERMINAL_STATES` |
| `packages/core/src/schemas/opportunity.ts` | `aceSubmission` field added to Item / ListItem; omitted from Create |
| `apps/functions/src/helpers/apn-client.ts` | Partner Central ops: `startEngagementFromOpportunity`, `getEngagementTaskStatus`, `submitOpportunityForReview`, `getOpportunityReviewSnapshot`, `advanceOpportunityStage` |
| `apps/functions/src/helpers/ace-submission.ts` | The state machine: `startAceSubmission`, `stepAceSubmission`, `isAceSubmissionEnabled` |
| `apps/functions/src/handlers/rfp-tracking/advance-ace-submissions.ts` | Scheduled poller — steps every in-flight record once per tick |
| `apps/functions/src/handlers/rfp-tracking/sync-linear-pipeline.ts` | Kicks off `startAceSubmission` on the submitted transition |
| `apps/functions/src/handlers/rfp-tracking/backfill-ace-submitted.ts` | Kicks off `startAceSubmission` for last month's submissions |
| `packages/infra/rfp-linear-sync-stack.ts` | Poller Lambda + 30-min EventBridge rule + IAM + env wiring |

Co-located tests: `ace-submission.test.ts` (24), `advance-ace-submissions.test.ts` (7),
plus the updated `sync-linear-pipeline.test.ts` / `backfill-ace-submitted.test.ts`.
Full functions suite: **1705 passing**.

---

## 4. Triggers

The bot is **kicked off** from two places (both flag-gated, idempotent, and
best-effort — they never break their host run):

1. **`sync-linear-pipeline`** — when an RFP crosses into the submitted state, the
   sync fires `startAceSubmission` right after `ensureAceTechnicalValidation`.
2. **`backfill-ace-submitted`** — the one-off backfill does the same for RFPs that
   were marked submitted before the trigger existed.

Both only *start* the pipeline. The **poller** (`advance-ace-submissions`, every
30 min) does all the subsequent stepping.

---

## 5. Safety design

- **Off by default.** Nothing runs unless `ACE_SUBMISSION_ENABLED=true`. The
  poller Lambda and both triggers are deployed but **inert** until the flag flips.
- **Sandbox-first.** The catalog defaults to production `AWS`, but
  `APN_SUBMISSION_CATALOG=Sandbox` exercises the entire lifecycle against Partner
  Central Sandbox — no real AWS reviewers touched. Validate in Sandbox before
  production.
- **Idempotent.** Every step is safe to repeat. Engagement start uses a
  deterministic `ClientToken` (`${orgId}-${oppId}-engage`) so a re-fire
  reattaches rather than duplicates.
- **Never throws.** A failure is caught, recorded on the `aceSubmission` record
  (`error`, `attempts++`), and the poller moves on. Transient API errors keep the
  current state and retry next tick — only an explicit AWS `Rejected` / task
  `FAILED` is terminal.
- **Human-in-the-loop.** `Action Required` pauses the record (`ACTION_REQUIRED`)
  instead of guessing — it's surfaced for a person to resolve.

---

## 6. Infrastructure

Stack: `AutoRfp-RfpLinearSync-<stage>` (`packages/infra/rfp-linear-sync-stack.ts`).

- **Poller Lambda** `auto-rfp-ace-submission-poller-<stage>` — NODEJS_22_X, 512 MB,
  5-min timeout, shared `lambdaRole`, bundles `@aws-sdk/client-partnercentral-selling`.
- **EventBridge rule** `auto-rfp-ace-submission-poller-<stage>` — `rate(30 minutes)`,
  `retryAttempts: 1`.
- **Log group** `/aws/lambda/auto-rfp-ace-submission-poller-<stage>` — 2-week
  retention (non-prod), `DESTROY`.
- **IAM** (added to the existing `PartnerCentralAccess` statement):
  `partnercentral:StartEngagementFromOpportunityTask`,
  `partnercentral:ListEngagementFromOpportunityTasks` (alongside the existing
  Create/Get/Update/List/Assign/SubmitOpportunity).
- **Env** shared across sync, backfill, and poller: `ACE_SUBMISSION_ENABLED`,
  optional `APN_SUBMISSION_CATALOG`.

Stack props (`RfpLinearSyncStackProps`):

```ts
aceSubmissionEnabled?: boolean;  // → ACE_SUBMISSION_ENABLED (default false)
aceSubmissionCatalog?: string;   // → APN_SUBMISSION_CATALOG ('Sandbox' | 'AWS')
```

---

## 7. How to enable

> **Deploy to the dev account `039885961427` only** (SSO profile
> `AdministratorAccess-039885961427`). Default credentials point at PROD
> `894608134501` — never deploy the bot there without explicit sign-off.
> `APN_CATALOG='AWS'` is the **production** Partner Central catalog:
> `SubmitOpportunity` / engagement submits to **real AWS reviewers**.

### Step 1 — Sandbox validation (recommended first)

In `packages/infra/bin/auto-rfp-infrastructure.ts`, on the
`RfpLinearSyncStack` instantiation:

```ts
aceSubmissionEnabled: true,
aceSubmissionCatalog: 'Sandbox',
```

Deploy to dev, then either wait for the 30-min poller or invoke
`auto-rfp-ace-submission-poller-dev` manually. Watch an opportunity walk
`NONE → ENGAGEMENT_PENDING → ENGAGED → SUBMITTED → ... → APPROVED → ADVANCED`
via its `aceSubmission.state`.

### Step 2 — Production catalog

Once the Sandbox walk is verified, drop the catalog override (defaults to `AWS`)
and keep `aceSubmissionEnabled: true`. Real submissions now flow to AWS review.

### To pause the bot

Set `aceSubmissionEnabled: false` (or delete the props) and redeploy. The poller
stays deployed but returns immediately (`disabled`); triggers become no-ops.
In-flight records are simply frozen at their current state until re-enabled.

---

## 8. Observability

- Poller returns `AdvanceAceSummary { inFlight, advanced, completed, failed, waiting, disabled }`,
  logged each run.
- Per-opportunity progress lives in `aceSubmission` (`state`, `reviewStatus`,
  `reviewComments`, `error`, `attempts`, `lastStepAt`).
- Records stuck in `ACTION_REQUIRED` or `REJECTED` carry `reviewComments` from AWS
  explaining what's needed.

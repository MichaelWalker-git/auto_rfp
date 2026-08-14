# FOIA Recipient Resolution — Investigation Findings

> **Status:** investigation only. No code was changed. This document is intended as
> input for a follow-up implementation agent.
>
> **Date:** 2026-08-13 · **Branch:** `feature/foia-automation`
> **Environment measured:** dev — AWS account `039885961427`, profile `horus-dev`,
> table `RFP-table-Dev` (us-east-1), 605 real opportunities.

---

## 1. The question

The automatic-FOIA feature decides, unattended, which government mailbox receives a
statutory records request filed in the customer's name. This investigation asked:
**how is that recipient email derived, and on real data, does it work?**

## 2. Verdict

**The resolver's design and its safety properties hold. The problem is coverage, not
correctness.**

- No evidence was found of any path that would mail the wrong agency. The matcher refuses
  rather than guesses, and refusals dominate the failures.
- On real data it resolves a trusted recipient for **189 of 328 SAM opportunities (58%)**
  and **0 of 35 HigherGov opportunities**.
- **3 of the 5 tiers are dead in production.** The cause is upstream contact data being
  dropped at import, plus two never-wired code paths — not the matching logic.
- The one live automation resolved correctly and is parked awaiting approval. Nothing has
  ever been transmitted to a real agency.

---

## 3. How resolution works today

`apps/functions/src/helpers/foia-recipient.ts:146` — `resolveFoiaRecipient()`. Five tiers,
first hit wins. Each result carries a `source`; `isTrustedFoiaRecipientSource`
(`packages/core/src/schemas/foia-automation.ts:151`) decides whether it may ever be sent
unattended.

| Tier | Source | Reads | Trusted | Live in prod? |
|---|---|---|---|---|
| 1 | `OPP_FOIA_OVERRIDE` | `opportunity.foiaContactEmail` | ✅ | ❌ 0/605 populated |
| 2 | `ORG_AGENCY_CONTACT` | org's confirmed-contact directory (exact key) | ✅ | ❌ 0 rows exist |
| 3 | `FOIA_GOV` / `HIGHERGOV_HIERARCHY` | mirrored FOIA.gov directory | ✅ | ✅ carries all load |
| 4 | `OPP_CONTACT` | `opportunity.contactEmail` (contracting officer) | ❌ | ❌ 6/605 populated |
| 5 | `DOCUMENT_SEARCH` | regex scan of extracted solicitation text | ❌ needs confirm | partly |
| — | none | → `blockedReason: NEEDS_RECIPIENT` | — | — |

Auto-send additionally requires **all three** of `settings.autoSendTrusted`, a trusted
source, and a verified award date (`foia-prepare.ts:186`). This layered gating is sound
and should be preserved by any change.

**Tier 3 is not a hardcoded map.** 614 components are mirrored monthly from
`api.foia.gov/api/agency_components` into DynamoDB under `PK=FOIA_COMPONENT`, with
`BY_TITLE#` / `BY_ABBR#` pointer rows carrying an ambiguity `count` so a match is two
`GetItem` calls and ambiguity can be refused without loading candidates
(`foia-component.ts:19-31`). Matching is pure and unit-testable
(`packages/core/src/schemas/foia-component.ts:271`).

**No LLM/Bedrock is involved in recipient resolution.**

### 3.1 Files that matter for this area

| Path | Role |
|---|---|
| `apps/functions/src/helpers/foia-recipient.ts` | **the resolver** — the 5-tier chain |
| `packages/core/src/schemas/foia-component.ts` | `normalizeAgencyTitle`, `matchFoiaComponent` (pure, unit-testable) |
| `apps/functions/src/helpers/foia-component.ts` | DynamoDB access + pointer rows; `listFoiaComponents` (**0 callers**) |
| `apps/functions/src/helpers/foia-agency-contact.ts` | tier-2 org directory, `markAgencyContactBounced` |
| `apps/functions/src/helpers/foia-doc-scan.ts` | tier-5 keyword-proximity scan |
| `apps/functions/src/helpers/highergov-agency.ts` | hierarchy walk (`orderHierarchyForMatching`) — currently unreachable |
| `apps/functions/src/helpers/foia-derive.ts` | builds the request; **only non-test caller of the resolver** (`:159`) |
| `apps/functions/src/helpers/foia-prepare.ts` | `autoSendEligible` gate (`:186`) |
| `apps/functions/src/helpers/foia-send.ts` | SES `SendRawEmail`, `sanitizeHeaderValue` |
| `apps/functions/src/handlers/foia/scan-foia-automation.ts` | the nightly reconciler |
| `apps/functions/src/handlers/foia/confirm-foia-recipient.ts` | manual entry → `USER_PROVIDED` |
| `apps/functions/src/handlers/foia/seed-foia-components.ts` | monthly FOIA.gov mirror |
| `apps/functions/src/handlers/foia/on-ses-event.ts` | bounces — **no test file** |
| `packages/core/src/schemas/foia-automation.ts` | states, blocked reasons, trust list (`:151`) |
| `packages/infra/foia-automation-stack.ts` | scan/seed Lambdas, SES config set (has uncommitted changes) |
| `apps/web/components/foia/FoiaAutomationCard.tsx` | candidate picker + manual entry + broken portal button |

Import paths that drop the upstream contact data (defects #1–#3):
`apps/functions/src/helpers/samgov.ts` (`toSlim`),
`apps/functions/src/handlers/search-opportunity/import-solicitation.ts`,
`run-saved-search.ts`, `import-highergov-favorites.ts`.

---

## 4. Measured reality

### 4.1 Field coverage (all 605 opportunities)

| Field | Present | Note |
|---|---|---|
| `contactEmail` (scalar, tier 4) | **6 / 605** | all 6 HigherGov; **0 of 328 SAM** |
| `contacts[]` (undeclared array) | **74 / 605** have an email | 26 distinct, mostly real `.gov` — **tier 4 never reads this** |
| `foiaContactEmail` (tier 1) | **0 / 605** | no writer exists anywhere in the codebase |
| `higherGovAgencyKey` (tier 3 walk) | **0 / 605** | declared + read + tested, never written |
| `jurisdiction` | **1 / 605** | 604 unset |

By source: SAM_GOV 328, MANUAL_UPLOAD 242, HIGHER_GOV 35.

### 4.2 Matcher replay against real agency names

The real `matchFoiaComponent` was replayed against every real `organizationName`, using the
actual 614-component directory and its pointer rows exported from DynamoDB:

| Source | n | Matched | Refused |
|---|---|---|---|
| SAM_GOV | 328 | **189** (187 `HIERARCHY_SEGMENT`, 2 `ABBREVIATION`) | 139 → 129 `NO_MATCH`, 10 `TITLE_AMBIGUOUS` |
| HIGHER_GOV | 35 | **0** | 26 `NO_MATCH`, 9 `EMPTY_INPUT` |
| MANUAL_UPLOAD | 242 | 2 | 134 `NO_MATCH`, 106 `EMPTY_INPUT` (test data / own-org names) |

### 4.3 Root cause of the 139 SAM failures — vocabulary, not logic

**Verified: trying *every* dot-path segment instead of stopping at the first hit recovers
0 additional matches.** The matcher is not the problem.

**FOIA.gov indexes components, not departments.** Only 10 of 548 indexed titles begin
"DEPARTMENT OF". The departments SAM names are simply absent:

| Missing root title | Failures | What FOIA.gov actually has |
|---|---|---|
| `DEPARTMENT OF VETERANS AFFAIRS` | **65** | `Veterans Health Administration` → `VHAFOIARequests@va.gov`; `Veterans Benefits Administration` → `foia.vbaco@va.gov`; `Veterans Affairs Central Office` → **inactive, no email** |
| `DEPT OF DEFENSE` | 25 | `Office of the Secretary of War and Joint Staff`, `Department of War Office of Inspector General`, … |
| `HEALTH AND HUMAN SERVICES, DEPARTMENT OF` | 9 | `Office of the Secretary` → `FOIARequest@hhs.gov` |
| `DISTRICT OF COLUMBIA COURTS` | 8 | absent — not federal |
| `TRANSPORTATION, DEPARTMENT OF` | 7 | `Office of the Secretary` (OST, no email) |
| `NATIONAL AERONAUTICS AND SPACE ADMINISTRATION` | 5 | only `NASA Shared Services Center` (no email) |
| `ENERGY, DEPARTMENT OF` | 4 | no department-level title |
| `LIBRARY OF CONGRESS` | 3 | absent |

The remaining ~40% therefore needs a **curated department → component alias map**, not
fuzzier string matching. Fuzzy matching would destroy the property that makes the current
design safe.

### 4.4 Root cause of all 35 HigherGov failures

Two independent causes:

1. **26 are not federal agencies** — `City of San Diego`, `City and County of San
   Francisco`, `Fresno Unified School District`. A federal directory can never resolve
   these.
2. **9 have an empty `organizationName`.**

Compounding: the hierarchy walk built specifically for HigherGov leaf offices is **doubly
dead** — `higherGovAgencyKey` is never written (0/605) *and* `foia-derive.ts:159` never
passes `higherGovConfig`. Both guards at `foia-recipient.ts:103` are always false.

### 4.5 Live state in dev

- **`FOIA_AUTOMATION`: 1 item.** `resolvedRecipientEmail = foia@bia.gov`,
  `recipientSource = FOIA_GOV`, `state = AWAITING_APPROVAL`, `autoSendEligible = false`,
  `attemptCount = 0`. **Tier 3 demonstrably works end-to-end on a real opportunity.**
- **`FOIA_REQUEST`: 21 items.** Only 2 are `AUTOMATED` (both `FOIA_GOV` → `foia@bia.gov`).
  The other 19 are manual test rows with personal Gmail addresses and typo'd variants
  (`ivanstadnik8@gmaill.com`, `brernnen@horustech.dev`). **`sentAt` present on 0.**
- **`ORG_AGENCY_CONTACT`: 0 items** — tier 2 is entirely empty; nothing human-confirmed yet.
- **`ORG_FOIA_SETTINGS`: 2 items**, both `autoSendTrusted = false`, `dailySendCap = 5`.
- **`FOIA_COMPONENT`: 1,718 rows = 614 components + 548 title pointers + 556 abbr
  pointers.** (Directory is fully seeded; 1,718 is *not* a component count.)
- **`FOIA_MAIL_SCAN`: 22 items**, all `AWARD_NOTICE` / `AWARD_RECORDED` — inbound mail is
  live and working.
- **SES:** outbound `horustech.dev` verified in us-east-1; inbound
  `foia@inbox.horustech.dev` in **us-west-2** under active rule set
  `auto-rfp-foia-inbound-Dev` (us-east-1's single rule-set slot belongs to an unrelated
  project). Bucket `auto-rfp-foia-inbound-dev-039885961427`, prefix `inbound/`.
  us-east-1 has production access (50k/day, 14/s). us-west-2 is still in the SES sandbox,
  which is **fine** — that region only receives; all sending is from us-east-1.
- **Logs:** `send-foia-request` and `confirm-foia-recipient` log groups are **empty over 7
  days** — no send ever attempted. `generate-foia-letter` ran but emits only
  `INIT_START`/`START`/`END`/`REPORT`: **there is no log line recording which tier
  resolved or which address was chosen.** The DynamoDB record is the sole artifact of a
  resolution decision.

---

## 5. Confirmed defects

Ordered by consequence. Each verified against code and/or live data.

1. **SAM contact data is discarded at import.** `toSlim`
   (`apps/functions/src/helpers/samgov.ts:94-122`) is a whitelist that omits SAM's
   `pointOfContact[]` (`fullName`, `email`, `type: primary|secondary`). The SAM persist
   block reads the **full untrimmed `oppRaw`**
   (`handlers/search-opportunity/import-solicitation.ts:212-234`), so the data is
   **already in memory and merely unread**. This is why tier 4 is unreachable for 328/328
   SAM records. Also dropped: `placeOfPerformance`, `uiLink`→`sourceUrl`,
   `fullParentPathCode`.

2. **Tier 4 reads only the scalar `contactEmail`, never `contacts[]`.**
   `foia-recipient.ts:202`. 74 opportunities carry a real contact email inside a
   `contacts[]` array of `{name, role, email}` (26 distinct, e.g.
   `Branka.MarkovicJovanovic@hud.gov`, `dia-cio-contracting@dia.mil`,
   `ivan.cabreros@dot.ca.gov`) — all invisible to the resolver. Note `contacts` is
   **not declared in `OpportunityItemSchema`**; it is written by the executive-brief
   extraction path, so treat it as a de-facto field to be formalised, not a typo.

3. **`higherGovAgencyKey` is never written**, despite `opportunity.ts:346-352` stating it
   is "retained so the FOIA recipient resolver can walk the agency hierarchy".
   `opp.agency` is in scope at all three HigherGov persist sites —
   `buildAgencyLabel(opp.agency)` is called one line above
   (`import-solicitation.ts:469`).

4. **`higherGovConfig` is never plumbed** into `resolveFoiaRecipient` from
   `foia-derive.ts:159`, the only non-test caller. Fixing #3 alone will not revive the walk.

5. **`NEEDS_AGENCY_MATCH` is a dead end.** The resolver emits it
   (`foia-recipient.ts:118`) and its label promises "Select which agency handles records
   requests for this office", but **`listFoiaComponents()` has zero callers** — no
   handler, no route in `foia.routes.ts`, no UI. The 10 `TITLE_AMBIGUOUS` SAM records land
   in a state whose only escape is generic manual entry.

6. **`webPortalUrl` is computed then dropped.** Flows `foia-recipient.ts:136` →
   `foia-derive.ts:182` → `foia-prepare.ts:161` and stops: `FoiaAutomationItemSchema` has
   no such field and the BLOCKED patch (`scan-foia-automation.ts:221-226`) omits it.
   Consequently the "Open Portal" button (`FoiaAutomationCard.tsx:305-312`) hrefs
   `automation.resolvedRecipientEmail` — an email or postal address, never a URL. Broken
   link on every `AGENCY_REQUIRES_PORTAL`.

7. **The resolver is jurisdiction-blind.** It never reads `opportunity.jurisdiction`, so a
   state/city agency is matched against a *federal* directory. No collision exists in
   today's data, but "Department of Transportation" vs. a state DOT is exactly that shape,
   and 26 real non-federal records are already flowing in. Tier 2's key
   (`normalizeAgencyKey`) also ignores state, so one org's "Department of Health" entry
   would be shared across all 50 states.

8. **A FOIA.gov-sourced bounce creates no suppression.** `markAgencyContactBounced`
   returns `null` when no directory row exists (`foia-agency-contact.ts:87`), and tiers
   1/3 never create one. A dead `FOIA_GOV` mailbox re-resolves identically on the next
   opportunity — the exact reuse the comment at `on-ses-event.ts:128-131` claims to
   prevent. `on-ses-event.ts` is also the **only FOIA handler with no test file**.

9. **`agencyFOIAEmail` is never format-validated on the automated path.**
   `FOIARequestItemSchema` types it `.email()`, but `foia-derive.ts:215` builds the object
   literally and `putItem` does no Zod parsing, so that check never runs for derived
   requests. `validateLetterFields` (`foia-letter.ts:46`) is a truthiness test only. Only
   CRLF sanitisation (`foia-send.ts:43`) stands between a malformed feed value and SES.
   No `.gov`/`.mil` restriction exists outside the document scanner, so tier 4 would
   accept a contractor's `@gmail.com`.

10. **`DOCUMENT_SEARCH` is never assigned as a source.** Confirming a scanned candidate
    routes through `confirm-foia-recipient.ts:61`, which hardcodes `USER_PROVIDED`,
    losing the provenance that a regex found it.

11. **No observability on the resolution decision.** The reconciler logs a per-run tally
    (`[foia-scan] finished: {...}`) but **no log line records the winning tier or the
    chosen address**; the DynamoDB row is the only artifact of a resolution decision.

12. **`NOTIFICATION_QUEUE_URL` is not wired into the FOIA stack**, so blocked-request
    notifications are silently dropped. Observed live at 2026-08-13T20:44:38Z:
    `WARN NOTIFICATION_QUEUE_URL not set — skipping notification FOIA_BLOCKED`.
    `collaboration-websocket-stack.ts:193` and `api-orchestrator-stack.ts:272` both set it;
    `foia-automation-stack.ts` does not. A user is never told a request needs their input —
    which matters more once the coverage gaps above start producing blocks.

### Already fixed — do NOT re-report these

The dev logs contain two reconciler errors that a fresh investigation will rediscover.
Both were fixed after the failing runs; the chronology in
`/aws/lambda/auto-rfp-foia-scan-Dev` on 2026-08-13 proves it:

- **20:49:31Z** — `AttributeValue for a key attribute cannot contain an empty string
  value. Key: partition_key`. Fixed by commit `bffde14d` (derived requests no longer carry
  placeholder `partition_key`/`sort_key`; see the docblock at `foia-derive.ts:190-205`).
- **21:10:46Z** — `AccessDenied … s3:PutObject on auto-rfp-documents-dev-…/…
  FOIA_Request_140A1626Q0072.txt`. Fixed by the **currently uncommitted** change to
  `packages/infra/foia-automation-stack.ts`, which splits the grant into read-anywhere plus
  `PutObject` scoped to `*/*/*/foia/*`.
- **21:14:41Z** — the next run reported `prepared: 1` with `errors: 0`, and the artifact
  now exists. Both issues are closed.

### Checked and dismissed (do not "fix")

- **SES config-set casing drift** — the name is duplicated between
  `api-orchestrator-stack.ts:269` and `foia-automation-stack.ts:312`, but both receive the
  same `stage` from `bin/auto-rfp-infrastructure.ts:41`, so the strings agree today.
  Fragile duplication, not a live break.
- **`normalizeAgencyTitle` correctness** — verified against real inputs including the
  inverted `"STATE, DEPARTMENT OF"` → `DEPARTMENT OF STATE` and the `U.S.` →
  `US COAST GUARD` regression. Behaves correctly.
- **Matcher root-first ordering** — deliberate and correct for SAM (leaf is a local field
  office whose words collide nationwide); the opposite leaf-first order for HigherGov is
  also deliberate (`highergov-agency.ts:164-177`). Both are documented and justified.

---

## 6. Suggested direction (not yet approved)

Phased so coverage wins land before the larger directory work.

### Phase 1 — recover data already in hand (lowest risk, unblocks the most)

- Add `pointOfContact` to `toSlim`'s shape and map
  `contactEmail`/`contactName`/`placeOfPerformance`/`sourceUrl` in the two SAM persist
  blocks (`import-solicitation.ts:232`, `run-saved-search.ts:287`), preferring
  `type: 'primary'`.
- Have tier 4 fall back to `contacts[]` (formalise it in `OpportunityItemSchema` first).
- Map `higherGovAgencyKey: opp.agency?.agency_key` at all three HigherGov persist sites
  (`import-solicitation.ts:483`, `run-saved-search.ts:550`,
  `import-highergov-favorites.ts:147`).
- Plumb `higherGovConfig` from `foia-derive.ts:159`.
- Add a backfill script for the 605 existing records: SAM via
  `fetchOpportunityViaSearch(noticeId)`, HigherGov via the stored `higherGovOppKey`.
  **No raw provider payload is retained anywhere**, so re-fetch is the only route.
- Add a log line recording the winning tier and address.

### Phase 2 — close the trusted-coverage gap

- **Curated department alias map** in `packages/core`, consulted only after an exact match
  fails, hand-verified and unit-tested per entry. Skip any department whose correct
  recipient is genuinely ambiguous rather than guessing.
- **The VA needs a human decision** — VHA vs. VBA vs. the inactive central office. This is
  a legal-recipient choice affecting 65 opportunities and should not be made
  unilaterally. Same question in weaker form for DoD and HHS.
- Never alias to an inactive/no-email component (the VA central office is exactly this).
- **Jurisdiction gate** — skip the federal directory when `jurisdiction === 'STATE'`, and
  include state in tier 2's SK. Requires backfilling `jurisdiction` (currently 1/605).

### Phase 3 — finish the half-built escapes

- `GET /foia-components` route + handler over the existing `listFoiaComponents()`, plus the
  agency-picker UI that `NEEDS_AGENCY_MATCH` already promises.
- Persist `webPortalUrl` and fix the `FoiaAutomationCard` button.
- Upsert a suppression row on bounce when none exists; add the missing `on-ses-event` tests.
- Validate `agencyFOIAEmail` in `foia-derive.ts`; consider requiring `.gov`/`.mil`/`.us`
  for untrusted tier 4.
- Stamp `DOCUMENT_SEARCH` when a confirmed candidate came from the scan.

---

## 7. How to reproduce the measurements

```bash
export AWS_PROFILE=horus-dev          # account 039885961427 — the DEFAULT profile is the WRONG account
# table is RFP-table-Dev (capital D), us-east-1

# field coverage
aws dynamodb query --table-name RFP-table-Dev --region us-east-1 --no-cli-pager \
  --key-condition-expression "partition_key = :pk" \
  --expression-attribute-values '{":pk":{"S":"OPPORTUNITY"}}' \
  --projection-expression "#src,organizationName,contactEmail,contacts,foiaContactEmail,higherGovAgencyKey,jurisdiction" \
  --expression-attribute-names '{"#src":"source"}' --output json > /tmp/opps.json

# matcher replay — step 1: export the pointer rows and the agency names
for P in BY_TITLE BY_ABBR; do
  aws dynamodb query --table-name RFP-table-Dev --region us-east-1 --no-cli-pager \
    --key-condition-expression "partition_key = :pk AND begins_with(sort_key,:sk)" \
    --expression-attribute-values "{\":pk\":{\"S\":\"FOIA_COMPONENT\"},\":sk\":{\"S\":\"${P}#\"}}" \
    --projection-expression "sort_key,componentId,#c" \
    --expression-attribute-names '{"#c":"count"}' --output json > /tmp/${P}.json
done

aws dynamodb query --table-name RFP-table-Dev --region us-east-1 --no-cli-pager \
  --key-condition-expression "partition_key = :pk" \
  --expression-attribute-values '{":pk":{"S":"OPPORTUNITY"}}' \
  --projection-expression "#src,organizationName" \
  --expression-attribute-names '{"#src":"source"}' --output json > /tmp/oppnames.json
```

Step 2 — replay the **real** matcher (requires `pnpm --filter @auto-rfp/core build` first,
since this imports from `dist`):

```js
// node --input-type=module -e '<this>'   — run from the repo root
import fs from 'fs';
const { matchFoiaComponent } = await import('./packages/core/dist/index.js');

const load = (f, prefix) => new Map(
  JSON.parse(fs.readFileSync(f, 'utf8')).Items.map((r) => [
    r.sort_key.S.replace(prefix, ''),
    { componentId: r.componentId.S, count: Number(r.count.N) },
  ]),
);
const T = load('/tmp/BY_TITLE.json', 'BY_TITLE#');
const A = load('/tmp/BY_ABBR.json', 'BY_ABBR#');
const lookup = { byNormalizedTitle: (k) => T.get(k), byAbbreviation: (k) => A.get(k) };

const stats = {};
for (const o of JSON.parse(fs.readFileSync('/tmp/oppnames.json', 'utf8')).Items) {
  const src = o.source?.S ?? 'NONE';
  const r = matchFoiaComponent(o.organizationName?.S ?? '', lookup);
  const key = r.matched ? `MATCH:${r.tier}` : `REFUSE:${r.refusal}`;
  stats[src] ??= {};
  stats[src][key] = (stats[src][key] ?? 0) + 1;
}
console.log(stats);
```

Expected output at the time of writing (the baseline any change must beat):

```
SAM_GOV       { HIERARCHY_SEGMENT: 187, ABBREVIATION: 2, NO_MATCH: 129, TITLE_AMBIGUOUS: 10 }
HIGHER_GOV    { NO_MATCH: 26, EMPTY_INPUT: 9 }
MANUAL_UPLOAD { HIERARCHY_SEGMENT: 2, NO_MATCH: 134, EMPTY_INPUT: 106 }
```

Caveat worth inheriting: `aws logs filter-log-events --start-time` returned empty even for
streams with events inside the window. Read streams directly with `get-log-events`; do not
treat an empty `filter-log-events` result as proof of no activity.

### Verification for any future change

- `cd packages/core && pnpm build && pnpm test`
- `cd apps/functions && pnpm test -- --testPathPattern=foia` — **525 existing FOIA tests
  must stay green.**
- **Re-run the replay above** and assert the SAM match rate rises from 189/328 **and** that
  no previously-refused record silently becomes a match without an alias entry justifying
  it.
- Keep `autoSendTrusted: false` throughout.

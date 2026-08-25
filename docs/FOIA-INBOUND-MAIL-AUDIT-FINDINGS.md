# FOIA inbound mail — audit findings

> Audit of every message the FOIA inbound pipeline has ingested, per
> `FOIA-INBOUND-MAIL-AUDIT-BRIEF.md`. **Audited 2026-08-17; all nine defects fixed
> 2026-08-18.** The audit pass itself was read-only; nothing was ever written to AWS.
>
> Method: all 110 raw messages were synced from S3 and replayed through the **real**
> production decision path (`parseRawMail` → `classifyMailDeterministic` →
> `correlateMailToOpportunities` → `decideInboundMail`) against the **real** 512
> HORUSTECH opportunities from `RFP-table-Dev`. Every decision below is the
> pipeline's own output, not a simulation. Harness:
> `apps/functions/src/helpers/__replay__/replay-audit.ts` (audit-only, not in any
> deployed bundle — delete or keep as a fixture generator).

---

## Corrections to the brief's numbers

| Metric | Brief | Measured | Note |
|---|---|---|---|
| Objects in mail bucket | 109 | **110** | |
| Rows in `FOIA_MAIL_SCAN` | 94 | **95** | |
| `OUR_OWN_REQUEST` | 17 | **18** | |
| Correlated to an opportunity | 6 | **10** | 6 award + 4 own-request |
| S3-vs-ledger gap | ~15 | **15** | fully explained below |

Current code also **disagrees with one stored ledger row**: `l7se2h195ois`
("Fwd: Award(s) Published for HACSC2026-RFP-03") is `UNRELATED/IGNORED` in the
ledger but classifies `AWARD_NOTICE/FLAGGED_FOR_REVIEW` today — the
`award-parenthesised-plural` fix landed after that message was ingested. The other
94 rows reproduce exactly.

## The 109-vs-94 gap: fully explained, not silent failures

| Cause | Count | Detail |
|---|---|---|
| Recipient was not the monitored mailbox | 10 | Auto-forwarded to `stevan@`/`michael@`/`proposals@`; SES accepted for those, so `findOrgByScrapeMailbox` correctly declined. Logged `no org claims` — BidNet/HigherGov/Linear/Google noise. |
| Not a real message | 2 | `AMAZON_SES_SETUP_NOTIFICATION`; `5200se2v60av` is **client-side-encrypted ciphertext** (`x-amz-key-v2` envelope) — a leftover from before the `kmsKey` removal documented in `foia-inbound-stack.ts`. Unreadable and unparseable by design. |
| **Genuine ingestion failures** | **3** | The 21:26–21:35 window on 2026-08-12: repeated `ValidationException: The AttributeValue for a key attribute cannot contain an empty string`. Three copies of the TTUHSC award notice were accepted by SES and never got a ledger row. |

The 3 failures are the pre-fix `buildMailScanSk` empty-key bug; the guard that now
throws a named error is in place. **They were never replayed** — SES retries were
exhausted, so those messages are permanently unprocessed. They are duplicates of a
notice that did land, so nothing was lost *here*, but there is **no DLQ and no
replay path** on this Lambda (`foia-inbound-stack.ts` sets no `deadLetterQueue`,
`onFailure`, or `retryAttempts`). A future failure on a unique message loses it
silently.

---

## Confirmed defects, ranked by consequence

Every one has a test committed against real message text.

```bash
cd apps/functions && npx jest --testPathPatterns='foia'
# 605 passed, 0 failed — all nine defects fixed.
```

**Status (2026-08-18): all 9 defects fixed.** Corpus replay shows five decisions
changed, every one intended:

| Message | Before | After |
|---|---|---|
| `obc93sn2d5kk` | `OUR_OWN_REQUEST` / `OWN_REQUEST_LOGGED` | `FOIA_RESPONSE` / **`RESPONSE_ATTACHED`** |
| `i3o2h82ak04i` | `OUR_OWN_REQUEST` / `OWN_REQUEST_LOGGED` | `SOLICITATION_CANCELLED` / `FLAGGED_FOR_REVIEW` |
| `pm4tl45k4m77` | `OUR_OWN_REQUEST` / `OWN_REQUEST_LOGGED` | `SOLICITATION_CANCELLED` / `FLAGGED_FOR_REVIEW` |
| `cvfodjo47ucp` | `UNRELATED` / `IGNORED` | `FOIA_RESPONSE` / `FLAGGED_FOR_REVIEW` (+ tracking `CPRA-0319`) |
| `57k9ipvt8le8` | `SOLICITATION_CANCELLED` / `FLAGGED_FOR_REVIEW` | `AWARD_NOTICE` / `FLAGGED_FOR_REVIEW` |

That `RESPONSE_ATTACHED` is the **first this pipeline has ever produced** — the verifier
who noted `applyResponse` had never executed was right, and this is why. The CA Parks
pair reached `SOLICITATION_CANCELLED` rather than merely `FOIA_RESPONSE`, which is the
stronger correct answer.

**Response outcomes are now right on every `FOIA_RESPONSE` row** (they were wrong on
four of six):

| Message | Outcome | Basis |
|---|---|---|
| `4soe9nenigvt` | `RECORDS_RECEIVED` | 3 real `attachment` parts |
| `vrl3d7c7m5q2` | `RECORDS_RECEIVED` | agency's words + SharePoint link (was right only by luck) |
| `615sciteu2kj`, `p1a3vs5829u7` | `NO_RECORDS_LOCATED` | "We do not have any … documents" (were `RECORDS_RECEIVED`) |
| `cvfodjo47ucp`, `obc93sn2d5kk` | `ACKNOWLEDGED` | agency acknowledgements |

False `DENIED` went from **8 of 110 real bodies to 0**; genuine denials still detected.
Full suite: **605 FOIA tests pass**, `packages/core` 862 pass, `tsc` clean.

### 1 · A UI timestamp shadows the agency's stated award date, still labelled verified — HIGH · ✅ FIXED

`foia-derive.ts:112-125` ranks `lossData.lossDate` **above** `outcomeDate`.

On the real opportunity `06b56638` ("RFP 739-SL3732580"), the pipeline did the right
thing: it read `Award Date 1/29/2026` from the agency notice and — only because the
agency stated it — wrote `outcomeDate = 2026-01-29` through the
`provenance === 'RECORDED_AWARD'` guard. But `lossData.lossDate` was already
`2026-06-10T14:02:32.066Z`, set when a user marked the opportunity lost in the UI.

```
resolveAwardDate(opp 06b56638) -> { date: '2026-06-10', provenance: 'RECORDED_AWARD' }
agency stated:                     2026-01-29
drift:                             132 days, labelled RECORDED_AWARD
isVerifiedAwardDateProvenance:     true  (permits an unattended send)
```

`lossDate` defaults to `new Date()` at click time
(`set-opportunity-outcome-dialog.tsx:229`), so it is "when we noticed", never "when
the agency awarded". This defeats the very guard `process-inbound-mail.ts:124` was
written to enforce — the one date an agency actually stated is discarded on read, and
the substitute is asserted as verified in a statutory letter's "awarded on or about".
`foia-dashboard.ts:57` has the same ordering, with a comment stating the inverted
assumption ("the former is what the agency did and the latter is when someone typed
it in").

**Fix (2026-08-18).** Not the reorder this originally proposed — that would have been
wrong. Checking the data first showed **84 of the 85** populated `outcomeDate` values
are terminal-status click stamps written by `opportunity-status.ts:151-155`
(`values[':outcomeDate'] = now`); only one is the agency-stated date from mail.
Promoting `outcomeDate` above `lossDate` would have relabelled all 84 as
`RECORDED_AWARD` — trading a 132-day error for a much broader one. The field is
overloaded, so the fix separates the two facts:

- new `agencyStatedAwardDate` on the opportunity schema, date-only (`YYYY-MM-DD`),
  documented as writable *only* from an agency-stated date;
- `applyAwardNotice` writes that field instead of `outcomeDate`, still behind the
  `provenance === 'RECORDED_AWARD'` guard;
- `resolveAwardDate` ranks it top, above `winData`/`lossData`; `outcomeDate` keeps its
  existing rank;
- `foia-dashboard.ts` matched, its inverted comment corrected, and the new field added
  to the projection (it is a projected query — omitting it would silently read
  `undefined`).

Incidental finding: the value already written to opp `06b56638` (`2026-01-29`) is
**schema-invalid** — `outcomeDate` is `z.string().datetime()`, which rejects a bare
date. It persisted because `updateOpportunity` does not validate the patch. The new
field's type matches what is actually written. That one row is stale data; it is
harmless now (nothing reads `outcomeDate` as an award date any more) but a backfill to
`agencyStatedAwardDate` would restore the correct date for that opportunity.

*Tests:* `foia-derive.test.ts` › "prefers the agency-stated award date over an
unrelated recorded loss date", plus "still ranks a recorded loss above a bare
outcomeDate stamp" — added to stop the fix over-reaching. Three
`process-inbound-mail.test.ts` assertions updated to the new field.

### 2 · A stored solicitation number of `2026-08` correlates on any ISO date — HIGH · ✅ FIXED

`foia-mail-correlate.ts:89-93`. Four HORUSTECH opportunities store date-shaped
numbers: `2026-08`, `2025-02`, `26-43`, `78-26`. `comparable('2026-08')` is 6 chars —
below `MIN_SUBSTRING_LENGTH` (7) — so matching falls to `matchesLiterally`, which only
needs a non-alphanumeric neighbour each side. In `response 2026-08-20` the neighbours
are a space and the `-` of `-20`. `isCorrelatableSolicitationNumber` screens only
`BATCH-`/`N/A`/`TBD`/`ABC-123` placeholders, not date shapes.

Fired twice on real mail (`h2mb4374b4al`, `t166jk3dt7mm` — a GSA helpdesk ticket
reminder correlating to "General Maintenance And Repair Services"). Harmless there
only because the classification was `UNRELATED`, which short-circuits before the
match is used. The escalation is real and I verified it by replay:

```
award notice, only identifier "Award Date 2026-08-04"
  -> AWARD_RECORDED against opp 8614b4c4 "General Maintenance And Repair Services"
```

`decideInboundMail` computes the match *before* the classification switch, then passes
`hasExternalIdentifier: !!single` into `canActAutomatically`, which returns true on an
external identifier **alone** with no HIGH-confidence requirement
(`foia-mail-classify.ts:479`). Wrong correlation → fabricated award date on an
unrelated opportunity → statutory letter to the wrong agency.

Mitigation that caps it today: if we *also* hold the correct opportunity, both match,
`matches.length > 1`, and it flags. The bad path needs the right opportunity to be
absent.

**Fix (2026-08-18).** `isCorrelatableSolicitationNumber` now rejects date-shaped stored
values via an anchored `DATE_SHAPED` pattern (`YYYY-MM` or `YYYY-MM-DD`, with real
month/day ranges). Validated against **all 479** stored solicitation numbers: it
rejects exactly `2026-08` and `2025-02` and keeps every legitimate fiscal-year form —
`26-43`, `78-26`, `RFP No. 26-22`, `RFP 07-26`, `RFP-25-124` — whose second segment is a
sequence number, not a month.

I did **not** tighten `canActAutomatically`, which I had initially flagged. That was my
error: reaching `AWARD_NOTICE` requires `awardHits.length > 0`, so a phrase match is
already guaranteed, and phrase + identifier is exactly the documented contract. The bug
was the identifier being a date; fixing it at the correlation layer is sufficient.

Corpus replay confirms **only the two intended correlations disappeared** and no other
decision changed across all 110 messages.

*Test:* `foia-mail-correlate.test.ts` › "does not correlate a date-shaped stored
number against an ISO date".

**Data note:** four HORUSTECH opportunities store `2026-08`, `2025-02`, `26-43`,
`78-26`. The first two are now uncorrelatable — correct, but those opportunities rely
on Level 2's timer rather than inbound mail. Worth fixing the underlying data.

### 3 · An agency's "was cancelled" is filed as our own outgoing request — HIGH · ✅ FIXED

Real: `i3o2h82ak04i` and `pm4tl45k4m77` (byte-identical body, two Message-IDs, two
ledger rows — one message forwarded twice). CA State Parks, `@parks.ca.gov`:

> "Unfortunately, C25910004 was cancelled and not awarded via IFB."

Signed by the Administrative Chief, **above** the fold; our quoted letter is below it.
Three failures stack:

1. **No `CANCELLED_PATTERNS` entry matches "was cancelled"** (`foia-mail-classify.ts:113-119`).
   `has-been-cancelled` needs "has been"; `solicitation-cancelled` needs the
   solicitation keyword *before* the verb, but here "IFB" trails it.
2. `REQUEST_CONTEXT_MARKERS` ctx2/ctx3 fire on **our own quoted letter** ("the notice
   of award and the awarded contract value", "All individual evaluator scoresheets"),
   zeroing `cancelledHits` at line 336.
3. The outbound gate (line 365) then wins on `pursuant-to-act`, also from the quoted
   letter → `OUR_OWN_REQUEST` at **HIGH** confidence.

This is the inverse of the twice-fixed bug: the pipeline ignored the agency's fresh
words and classified on our own quoted text. The module's own comment (lines 361-364)
says "a reply marker outranks an outbound marker" — but the reply set has no pattern
for a terse cancellation, so the protection never engages.

`OWN_REQUEST_LOGGED` is terminal and silent. The single most decision-relevant fact
available — no award will ever exist — is discarded into a TTL'd row.

**Fix (2026-08-18) — this is root cause A, and it also closes defects 7 and 9.**

New `stripQuotedReply` in `foia-mail-parse.ts` returns only the text attributable to
the most recent author who is not us, cutting at a `From:` line or an
`On … wrote:` attribution **that names us**. Deliberately not the first marker of any
kind: two real messages open with `----- Forwarded message -----` at offset 0 (we
forwarded the agency's reply), and one nests three authors, so cutting at the first
marker would discard the agency's words entirely. Two details came from the real bytes
rather than from guessing — the attribution **wraps across lines**, and Gmail emits a
narrow no-break space (U+202F) before "AM"; my first pattern matched neither.

`classifyMailDeterministic` now splits its haystack by what the pattern is *claiming*:

- **authorship** signals (`OUTBOUND_MARKERS`, `REQUEST_CONTEXT_MARKERS`,
  `CANCELLED_PATTERNS`, `AWARD_PATTERNS`) read **our-words-removed** text — "pursuant
  to the … Act" proves the message is ours only if *we* wrote that line;
- **subject-matter** signals (records statutes, identifiers, tracking numbers) keep
  reading the full body, since a solicitation number is equally true wherever it
  appears and the terse replies have almost no body of their own.

Two further gaps surfaced only by running it, and neither was in my original analysis:

1. **A second path to `OUR_OWN_REQUEST`.** Removing the marker dropped confidence
   HIGH→MEDIUM but the message still landed at the records-statute fallback, which
   assumes "most likely our own request". That is right for a bare forwarded subject
   line, wrong for an agency-authored reply, so it now yields `FOIA_RESPONSE` when a
   public body sent it **and wrote prose of its own** — the second condition preserves
   the subject-only-forward case the existing tests (correctly) assert.
2. **The Google Group relay erases the sender.** It rewrites `From:` to
   `proposals@horustech.dev`, so `isGovernmentSender` is false for four real agency
   replies. New `hasGovernmentAuthorInThread` reads the forwarded header block,
   stopping at the first `From:` naming us — past that point the `.gov` addresses are
   ones we wrote *to*. Verified: recovers the two CA Parks messages, misfires on none
   of the 11 genuine outbound letters.

Still not recovered: `848ko1tghclg`, `lanfoc9kkmg5`, `6bh3ncdo9e10`, `04tvnbq4teg4`.
These arrive via the relay with **no forwarded header at all** — the agency identity
exists only in a signature block ("Procurement Analyst I, City of Long Beach"). Reading
signatures is guesswork I did not want to add; the durable fix is a reply-marker
pattern for procedural redirects (defect 8's family) or preserving the original sender
at the relay.

*Tests:* `foia-mail-classify.test.ts` › 'recognises an agency stating a solicitation
"was cancelled" in a reply', › "treats an agency forwarding our request internally as a
reply, not as ours", › "recovers a public-body author the Google Group relay hid", ›
"does not read the agency we wrote TO as the author"; four `stripQuotedReply` cases in
`foia-mail-parse.test.ts`.

### 4 · A retracted *award posting* suppresses the FOIA — HIGH (latent) · ✅ FIXED

Real: `57k9ipvt8le8`, BidNet: *"The following award has been cancelled: Solicitation:
4142 — Award Type: Award"*. BidNet is retracting the **award publication** — the
solicitation is alive and a new award will follow. Both `has-been-cancelled` and
`solicitation-cancelled` match, so it reads `SOLICITATION_CANCELLED`.

Verified by replay: with opportunity 4142 present this yields **`SUPPRESSED`** —
withdrawing the FOIA automation precisely when an award *is* coming, the exact inverse
of the intended safety property. It escaped only because no stored opportunity is
numbered 4142.

*Test:* `foia-mail-classify.test.ts` › "does not treat a retracted AWARD posting as a
cancelled solicitation".

### 5 · "We do not have any documents" recorded as records received — HIGH · ✅ FIXED

Real: `615sciteu2kj` / `p1a3vs5829u7`, SC Division of Procurement Services:

> "This solicitation was cancelled after opening but before award with the intent to
> resolicit. **We do not have any** evaluation/scoring or debriefing **documents**.
> This fulfills your request."

`readResponseOutcome`'s `no-records-located` pattern requires "no records …
was/were located|found|identified"; this phrasing is unreachable. It falls through to
the attachment branch, where `attachmentNames` is `['Outlook-em5gwklr']` — an inline
Outlook artifact — and `attachmentNames.length > 0` short-circuits to
`RECORDS_RECEIVED`.

Two independent defects, either alone sufficient. The fact inverted here exists
nowhere else: the agency holds nothing *and* the solicitation was cancelled before
award. A reviewer sees "records received" and stops looking. (Note this message also
states a cancellation that nothing acts on — same gap as defect 3.)

*Test:* `foia-mail-ingest.test.ts` › 'reads "we do not have any documents" as no
records located'.

### 6 · Signature-block images assert RECORDS_RECEIVED, masking denials — MEDIUM · ✅ FIXED

`readResponseOutcome:110` gates on a bare `attachmentNames.length > 0`, checked
**before every DENIED pattern**. `readFileName` (`foia-mail-parse.ts:122-132`) accepts
a filename from Content-Disposition *or* a Content-Type `name=`, so an inline
Content-ID signature graphic is indistinguishable from a released record — nothing
inspects disposition, Content-ID, or extension.

**12 of 110 messages** have attachment lists composed *entirely* of decorative images
and all report `RECORDS_RECEIVED`: three live `FOIA_RESPONSE` rows plus GSA template
art (`Cloud 4.png`, `Jefferson Light Blue 2.png`) and Outlook `image.png` /
`signature_*` artifacts.

The dangerous case: an agency denying a request **from Outlook** has its denial masked.
A verifier argued this ordering currently *prevents* false `DENIED` from our own
boilerplate — true, but that is defect 7, and the fix for 7 removes the excuse for 6.
No agency-authored denial is masked in today's corpus, so this is latent.

*Test:* `foia-mail-ingest.test.ts` › "does not treat signature-block images as produced
records".

### 7 · `DENIED` fires on our own boilerplate — MEDIUM · ✅ FIXED

`readResponseOutcome:123`: `/\b(?:your\s+)?request\s+(?:is|has\s+been)\s+denied\b/`.
The optional `your` makes it match our own template's conditional *"If any portion of
this request is denied or withheld…"*.

The comment above the block asserts "Every pattern requires the agency as the actor"
and that our letter's conditional forms "cannot match". **That guarantee is false for
this pattern** — the `withheld` half was fixed, the `denied` half was not. It fires on
**8 of 110** real bodies and in *every* case the match is our own boilerplate, never an
agency denial.

**Fix (2026-08-18).** Two layers, because the corpus showed one was not enough.
`readResponseOutcome` now reads `stripQuotedReply(bodyText)`, which removes the clause
in the forwarded replies — that took real false positives from 8 to 4. The remaining 4
are genuine outbound letters where the clause is our own top-level text, so no
stripping can help: the pattern itself now requires the possessive (`your request is
denied`, as an agency writes it, not `this request`) and bails on a hypothetical
(`if|should|unless|in the event … denied`). **8 real bodies → 0**, genuine denials
intact.

My original test fixture for this was weak — I had extracted the clause without its
surrounding thread, so nothing marked it as quoted and it could not exercise the
stripping path. Replaced with the clause in its real position beneath an agency reply,
plus a positive case asserting genuine denials still register.

*Tests:* `foia-mail-ingest.test.ts` › "does not read our own letter's conditional denial
clause as a denial", › "ignores a denial clause quoted from our letter beneath an agency
reply", › "still reads a real agency denial".

### 8 · An agency acknowledgement with an acronym-only tracking number is IGNORED — MEDIUM · ✅ FIXED

Real: `cvfodjo47ucp`, LA Fire & Police Pensions: *"We have received your CPRA / FOIA
request. CPRA-0319"*. Classified `UNRELATED` with **`matchedOn: []`** — not one pattern
fired. Each misses by one token:

- `we-received-your-request` needs `request|records` *immediately* after "your"; the
  real subject interposes the statute ("your **CPRA / FOIA** request").
- `records-request-received` needs "received" *after* the phrase; the agency leads with it.
- `records-act-request` / `records-act` need the statute spelled out; LAFPP writes the
  acronym and pairs "Act" with "inquiry".
- Tracking patterns want `DD-DDDD` after the acronym; `CPRA-0319` is acronym + one group.

`UNRELATED` is the one class that leaves nothing behind. The tracking number the agency
told us to quote on every follow-up is discarded, so the next LAFPP reply — which will
cite only `CPRA-0319` — has nothing to correlate against either.

*Test:* `foia-mail-classify.test.ts` › "recognises an agency acknowledgement that names
the statute by acronym only".

### 9 · An agency forwarding our request internally is filed as ours — MEDIUM · ✅ FIXED

Real: `obc93sn2d5kk`, `@sbcusd.k12.ca.us` — an
agency-domain sender, `Re:` subject, correlated cleanly to opp `92e0e4fe`:

> "I am forwarding you the request for records I received."

First-person "**I** received" matches none of the reply patterns (all need
we/this-office + "your"), while our quoted letter supplies `pursuant-to-act` and
`copies-of-following`. `gov-sender` **is** computed at line 317 and then **ignored** —
the gate at line 365 never consults `matchedOn`. Proof of agency receipt is discarded
on the one message that correlated unambiguously.

**Fixed by root cause A** (see defect 3). This is now the pipeline's first-ever
`RESPONSE_ATTACHED`: the reply correlates unambiguously to opp `92e0e4fe`, so
`responseOutcome` and `responseReceivedAt` are finally written.

*Test:* `foia-mail-classify.test.ts` › "treats an agency forwarding our request
internally as a reply, not as ours".

---

## The systemic finding: `FLAGGED_FOR_REVIEW` goes nowhere

The brief states flagging "is the designed outcome for anything ambiguous, not a
failure". That holds **only if a human sees it**, and nothing does:

```
FOIA_MAIL_SCAN_PK  -> one createItem. Never a get, never a query. Write-only.
FLAGGED_FOR_REVIEW -> zero references outside foia-mail-ingest.ts. No UI, no queue.
notifyOrg          -> returns early for anything except AWARD_RECORDED / SUPPRESSED.
ledger TTL         -> 90 days; these rows expire 2026-11-10..15.
```

So of 110 objects: 3 `AWARD_RECORDED` changed state; **12 `FLAGGED_FOR_REVIEW`, 18
`OWN_REQUEST_LOGGED` and 62 `IGNORED` produced no durable, human-visible artifact
at all.** "Refuse rather than guess" is implemented, but the refusals are invisible
and self-deleting. This also blunts every fix above: correctly reclassifying defect 3
from `OUR_OWN_REQUEST` to a flag would change nothing observable today.

**This is the highest-leverage item in the audit** — it is worth more than any single
pattern fix, because it is what makes the conservative design actually safe.

## Also worth fixing

- **No sender trust gate.** `isGovernmentSender`/`isKnownSolicitationSender` are
  computed as evidence and never gate an action. The 6 award notices that set a real
  award date came from **`noreply@horustech.dev`** — our own SES identity. Nothing
  distinguishes them from an agency. The SES `spf/dkim/dmarc/spam/virus` verdicts are
  supplied in the test fixture (`process-inbound-mail.test.ts:118-122`) but **never
  read in production** — a fixture asserting a guarantee the code does not provide.
- **Google Group relay erases the sender.** Replies arriving via the group are
  rewritten to `proposals@horustech.dev`, so `isGovernmentSender` returns false for
  genuine agency mail (`cvfodjo47ucp`, `lanfoc9kkmg5`, `6bh3ncdo9e10`, `04tvnbq4teg4`).
  The agency identity is only in the body signature.
- **No DLQ on the inbound Lambda** — see the gap table.
- **Award writes are unattributed.** `applyAwardNotice` calls `updateOpportunity`
  with no `userContext`, so `updatedBy`/`updatedByName` keep the last *human* who
  touched the record. Opp `06b56638` reads "Krava" for a write the Lambda made.

## What is NOT broken — do not re-audit

- **No agency-domain sender landed in `UNRELATED`** (0 of 73). The classifier is not
  broadly blind to agency mail; the misses are specific phrasings.
- **The 3 `AWARD_RECORDED` writes are idempotent** — 6 deliveries of the same notice
  (each with a fresh SES Message-ID, so the RFC dedupe legitimately could not collapse
  them) all wrote the same `2026-01-29`. Correct provenance (`RECORDED_AWARD` from a
  stated date), correct opportunity.
- **Org scoping holds.** `RFP 739-SL3732580` exists in two orgs; the candidate list is
  built per-org, so no cross-tenant match occurred.
- **The two `SOLICITATION_CANCELLED` flagged rather than suppressed is correct** — no
  stored opportunity holds 4142 or 26-061, so the empty Cancelled bucket is a data
  artifact, not a broken transition. (The classification of one of them is still wrong
  — defect 4.)
- **`vrl3d7c7m5q2` → `RECORDS_RECEIVED` is right**: Las Virgenes MWD did produce
  records via SharePoint ("District staff members have located records responsive to
  your request"). Right answer, but reached via the attachment count (defect 6), so it
  is right by luck.
- **BidNet/HigherGov digests, addenda, bid-intent reminders, and vendor cold-pitches
  are correctly `UNRELATED`.**

## Coverage

| Group | Count | Audited by |
|---|---|---|
| `AWARD_NOTICE` | 13 | me, directly |
| `FOIA_RESPONSE` + `SOLICITATION_CANCELLED` | 6 | me, directly |
| `OUR_OWN_REQUEST` | 18 | agent batch + adversarial verify |
| `UNRELATED` | 38 | agent batches + adversarial verify |
| `UNRELATED` (remainder) | 35 | re-run agent batches (all 35 read, 0 findings) + mechanical triage by me |

**110 of 110 messages audited.** The first fan-out lost 4 of 7 batches to stalled
agents; I audited the two high-consequence ones (`AWARD_NOTICE`,
`FOIA_RESPONSE`/`SOLICITATION_CANCELLED`) myself and re-ran the 35 remaining
`UNRELATED`, which came back clean with every file confirmed read. That agrees with my
own mechanical triage of those 35 (screening for gov-domain senders, award/cancel
wording, and spurious correlations), which surfaced only `t166jk3dt7mm` — already
covered by defect 2 — plus two I read in full and confirmed correct (`5ffr6g6plt1n`, a
City of Long Beach opportunity newsletter; `0hmnrjqi6e14`, a vendor cold-pitch).

Nine claims from the agents were adversarially verified; **one was refuted** (the
inline-image issue as originally framed — its own cited example turned out to be a
correct `RECORDS_RECEIVED`), and I kept it at reduced severity as defect 6 because the
denial-masking mechanism is real. Severities on four others were corrected **down**
from CRITICAL/HIGH by the verifiers, and I have kept their corrections: with
`autoSendTrusted` false and nothing ever transmitted to a real agency, all harm here
is latent.

## Full message table

`docs/foia-inbound-mail-audit-table.csv` — one row per message (110): s3 key, date,
sender, subject, classification, action, correlated oppId, whether a ledger row
exists, attachment count. Regenerate with the replay harness:

```bash
export AWS_PROFILE=horus-dev
aws s3 sync s3://auto-rfp-foia-inbound-dev-039885961427/inbound/ /tmp/foia_mail/ --region us-west-2
cd apps/functions && DB_TABLE_NAME=unused REGION=us-east-1 AWS_REGION=us-east-1 \
  npx tsx src/helpers/__replay__/replay-audit.ts /tmp/foia_mail /tmp/candidates.json /tmp/replay.json
```

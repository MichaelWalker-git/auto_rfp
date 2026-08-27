/**
 * Notary wiring (u2-notary-backend-wiring).
 *
 * The shared glue between the u1 notary engine (`@/helpers/notary-detection`) and
 * the two intake hook points (`detect-required-forms.ts` body scan / WF-A and
 * `textract-forms-callback.ts` page scan / WF-B) plus the opportunity rollup and
 * proactive notification (`mark-forms-ready.ts` / WF-D).
 *
 * u2 contains NO detection logic of its own — it builds `NotaryTextSegment`s from
 * solicitation text / DOCX-XLSX field text / Textract page blocks, calls the u1
 * engine, merges the result, and persists it. Every function here is best-effort:
 * a scan/engine/write failure never throws into the Step Function or the SNS
 * callback, and no failure path reports a real requirement as a clean
 * `NOT_REQUIRED` (the zero-miss floor — NFR1/NFR3).
 *
 * The USER_SET override (FR7.2) is protected by ATOMIC DynamoDB conditional
 * writes guarded on the AI_DETECTED source marker — the write condition is the
 * guard, never a prior read, so there is no read-check-write (TOCTOU) race.
 *
 * Model access (NFR5.6): the model id is read from the stack-default
 * `BEDROCK_MODEL_ID` env and passed to the u1 engine, which owns the HTTP-client
 * call. u2 never imports the Bedrock SDK and never pins a model id.
 */
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { docClient, isConditionalCheckFailed } from './db';
import { requireEnv } from './env';
import { nowIso } from './date';
import { PK_NAME, SK_NAME } from '../constants/common';
import { OPPORTUNITY_PK } from '../constants/opportunity';
import { buildOpportunitySk } from './opportunity';
import { getOpportunity } from './opportunity';
import {
  listRequiredFormsByOpportunity,
  updateRequiredForm,
  type RequiredFormDBItem,
} from './required-form';
import { detectNotaryRequirements, mergeNotaryRequirements } from './notary-detection';
import { normalizeFormNameKey, containsAtWordBoundary } from './compliance-review-missing-forms';
import { sendNotification, buildNotification } from './send-notification';
import { getOrgMembers } from './user';

import {
  statusSeverity,
  type DetectedFormField,
  type NotaryClassificationSource,
  type NotaryRequirement,
  type NotaryStatus,
  type NotarySummary,
  type NotaryTextSegment,
} from '@auto-rfp/core';

// ─── Model id (stack default, never pinned) ───────────────────────────────────

/**
 * The model id for the notary Stage-2 verification, inherited from the stack
 * default `BEDROCK_MODEL_ID` (same env the other AI handlers read). Never pinned
 * here — a hardcoded/EOL id fails via the API key. Throws only if the env is
 * unset; callers run this inside their best-effort try so a missing env degrades
 * to POSSIBLY_REQUIRED review-manually rather than a silent miss.
 */
export const getNotaryModelId = (): string => requireEnv('BEDROCK_MODEL_ID');

// ─── Pure helpers — segments, mapping, status, summary ────────────────────────

/** Minimal shape the wiring reads off a required form. */
type FormLike = Pick<RequiredFormDBItem, 'formId' | 'name'> & {
  fields?: DetectedFormField[];
  notaryStatus?: NotaryStatus;
  notaryRequirements?: NotaryRequirement[];
};

/** Minimal shape of a Textract block used to build FORM_PAGE segments. */
type TextractBlockLike = { BlockType?: string; Text?: string; Page?: number };

/** Join a form's field labels/values into a single scannable text blob. */
const formFieldText = (form: FormLike): string =>
  (form.fields ?? [])
    .flatMap((f) => [f.label, f.value ?? ''])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join('\n');

/**
 * Build the segments for the WF-A body scan: one SOLICITATION_BODY segment from
 * the in-memory docText, plus a FORM_FIELD segment (carrying formId) for every
 * form whose inline-parsed field text is non-empty (DOCX/XLSX forms parsed to
 * READY in the same handler — FR2.3). PDF forms have empty fields at this point
 * and contribute nothing here (their page scan runs in WF-B).
 */
export const buildSolicitationSegments = (
  docText: string,
  solicitationDocName: string,
  forms: FormLike[],
): NotaryTextSegment[] => {
  const segments: NotaryTextSegment[] = [];
  const docName = solicitationDocName?.trim() ? solicitationDocName : 'solicitation';

  if (typeof docText === 'string' && docText.trim().length > 0) {
    segments.push({ text: docText, source: 'SOLICITATION_BODY', documentName: docName });
  }

  for (const form of forms ?? []) {
    const text = formFieldText(form);
    if (text.trim().length > 0) {
      segments.push({
        text,
        source: 'FORM_FIELD',
        documentName: form.name?.trim() ? form.name : docName,
        formId: form.formId,
      });
    }
  }

  return segments;
};

/**
 * Build FORM_PAGE segments from a Textract block list, one segment per page
 * (BR8.1). Uses LINE blocks (they carry the page's readable text without the
 * WORD-level duplication); every segment carries the form name, its formId, and
 * the block's `.Page` so page-level evidence is preserved (u1 BR6.2).
 */
export const buildFormPageSegments = (
  blocks: TextractBlockLike[],
  form: FormLike,
): NotaryTextSegment[] => {
  const byPage = new Map<number, string[]>();
  for (const b of blocks ?? []) {
    if (b?.BlockType === 'LINE' && typeof b.Text === 'string' && typeof b.Page === 'number') {
      const arr = byPage.get(b.Page) ?? [];
      arr.push(b.Text);
      byPage.set(b.Page, arr);
    }
  }

  const documentName = form.name?.trim() ? form.name : 'form';
  const segments: NotaryTextSegment[] = [];
  for (const [page, texts] of byPage) {
    const text = texts.join(' ').trim();
    if (text.length > 0) {
      segments.push({ text, source: 'FORM_PAGE', documentName, formId: form.formId, pageNumber: page });
    }
  }
  return segments;
};

/**
 * Tokenize text for form-name mention matching: lowercase, every run of
 * non-alphanumerics becomes ONE space, trimmed. Unlike `normalizeFormNameKey`
 * (which DELETES punctuation, gluing "SF-1413" into "sf1413" while "SF 1413"
 * stays "sf 1413" — fine for whole-name equality, useless for substring
 * matching), this preserves token boundaries so "SF-1413", "SF 1413" and
 * "sf_1413" all key to "sf 1413".
 */
export const mentionKey = (s: string): string =>
  (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Strip a trailing file extension before mention-keying a form name. */
const FILE_EXT_RE = /\.(pdf|docx?|xlsx?)\s*$/i;

/**
 * A form name is mention-eligible when it is specific enough that a
 * word-boundary hit inside a 120-char trigger snippet is a real reference:
 * it carries a digit ("SF-1413", "W-9", "Attachment 3") or is at least 6
 * chars ("Affidavit of Non-Collusion"). A purely generic short name
 * ("Form", "Bid") would match everyday prose, so it never mention-maps.
 */
const isMentionEligible = (key: string): boolean => key.length > 0 && (/\d/.test(key) || key.length >= 6);

/**
 * Split engine requirements into per-form buckets and an unmapped remainder
 * (BR7.2). A requirement maps to a form when, in order:
 *   1. it carries a known `formId` (FORM_FIELD / FORM_PAGE sources);
 *   2. its `documentName` conservatively normalizes to a detected form's name;
 *   3. its verbatim `triggeringText` MENTIONS a detected form's name at a word
 *      boundary ("Form SF-1413 must be notarized" → the SF-1413 form). A clause
 *      naming several forms maps to EACH of them; the boundary check keeps
 *      "Attachment 1" from matching "Attachment 10" text.
 * Everything else (generic solicitation-body mentions like "all forms must be
 * notarized") is retained as an opportunity-level trigger for the rollup —
 * never dropped.
 */
export const mapRequirementsToForms = (
  requirements: NotaryRequirement[],
  forms: FormLike[],
): { byFormId: Map<string, NotaryRequirement[]>; unmapped: NotaryRequirement[] } => {
  const byFormId = new Map<string, NotaryRequirement[]>();
  const unmapped: NotaryRequirement[] = [];

  const idSet = new Set(forms.map((f) => f.formId));
  const nameKeyToId = new Map<string, string>();
  const mentionable: Array<{ formId: string; key: string }> = [];
  for (const f of forms) {
    const key = normalizeFormNameKey(f.name ?? '');
    if (key && !nameKeyToId.has(key)) nameKeyToId.set(key, f.formId);
    const mKey = mentionKey((f.name ?? '').replace(FILE_EXT_RE, ''));
    if (isMentionEligible(mKey)) mentionable.push({ formId: f.formId, key: mKey });
  }

  const push = (formId: string, r: NotaryRequirement) => {
    const arr = byFormId.get(formId) ?? [];
    arr.push(r);
    byFormId.set(formId, arr);
  };

  for (const r of requirements ?? []) {
    let formId: string | undefined;
    if (r.formId && idSet.has(r.formId)) {
      formId = r.formId;
    } else {
      const key = normalizeFormNameKey(r.documentName ?? '');
      if (key && nameKeyToId.has(key)) formId = nameKeyToId.get(key);
    }

    if (formId) {
      push(formId, r);
      continue;
    }

    // Tier 3 — mention matching: the trigger snippet names a specific form.
    // The clone carries the mapped formId so the strongest-signal merge groups
    // the evidence under the form (targetKey = formId ?? documentName).
    const trigger = mentionKey(r.triggeringText ?? '');
    const matched = trigger.length > 0
      ? mentionable.filter((m) => containsAtWordBoundary(trigger, m.key))
      : [];
    if (matched.length > 0) {
      for (const m of matched) push(m.formId, { ...r, formId: m.formId });
    } else {
      unmapped.push(r);
    }
  }

  return { byFormId, unmapped };
};

/**
 * The strongest-signal status across a requirement set (BR8.2). Empty set →
 * NOT_REQUIRED (a genuinely empty scan is legitimately clean).
 */
export const computeNotaryStatus = (requirements: NotaryRequirement[]): NotaryStatus => {
  let best: NotaryStatus = 'NOT_REQUIRED';
  for (const r of requirements ?? []) {
    if (statusSeverity(r.status) > statusSeverity(best)) best = r.status;
  }
  return best;
};

/**
 * The canonical POSSIBLY_REQUIRED "notary scan did not complete — review
 * manually" requirement for a u2-SIDE scan failure (BR7.3 / BR8.3). Distinct from
 * the u1 truncation entry ("not fully scanned"): this fires when the engine was
 * meant to run for a form but a u2-side error prevented it — the form must never
 * be left at the clean NOT_REQUIRED default.
 */
export const buildReviewManuallyRequirement = (
  documentName: string,
  formId?: string,
): NotaryRequirement => ({
  ...(formId ? { formId } : {}),
  documentName: documentName?.trim() ? documentName : 'this form',
  status: 'POSSIBLY_REQUIRED',
  cue: 'INSTRUCTIONAL',
  pageNumber: null,
  triggeringText: 'Notary scan did not complete — review manually.',
  rationale: 'The notary scan did not complete for this item — review manually.',
});

/**
 * Compute the opportunity-level NotarySummary (BR10.1) from every form's
 * notaryStatus. `requiredCount` / `possiblyRequiredCount` count FORMS only, so
 * they are always ≤ `totalFormsConsidered` and "N of M form(s)" displays stay
 * coherent. Unmapped solicitation-instruction triggers (BR10.3) contribute to
 * `anyNotaryRequired` — a generic "all bids must be notarized" still flags the
 * opportunity — but are NOT forms and never inflate the per-form counts
 * (pre-fix they each added +1, producing "23 of 16 form(s)").
 */
export const summarizeNotary = (
  forms: FormLike[],
  unmappedTriggers: NotaryRequirement[] = [],
): NotarySummary => {
  let requiredCount = 0;
  let possiblyRequiredCount = 0;

  for (const f of forms ?? []) {
    const status = f.notaryStatus ?? 'NOT_REQUIRED';
    if (status === 'REQUIRED') requiredCount++;
    else if (status === 'POSSIBLY_REQUIRED') possiblyRequiredCount++;
  }
  const anyUnmappedFlagged = (unmappedTriggers ?? []).some(
    (t) => t.status === 'REQUIRED' || t.status === 'POSSIBLY_REQUIRED',
  );

  return {
    anyNotaryRequired: requiredCount > 0 || possiblyRequiredCount > 0 || anyUnmappedFlagged,
    requiredCount,
    possiblyRequiredCount,
    totalFormsConsidered: (forms ?? []).length,
    computedAt: nowIso(),
  };
};

/**
 * The notification change-guard (BR11.2): compare ONLY the notary-material fields
 * of the new summary against the stored prior one — anyNotaryRequired,
 * requiredCount, possiblyRequiredCount. `totalFormsConsidered` and `computedAt`
 * are excluded so adding a non-notary form never re-notifies. A missing prior
 * summary counts as changed (first computation).
 */
export const notarySummaryMaterialChanged = (
  prev: NotarySummary | null | undefined,
  next: NotarySummary,
): boolean => {
  if (!prev) return true;
  return (
    prev.anyNotaryRequired !== next.anyNotaryRequired ||
    prev.requiredCount !== next.requiredCount ||
    prev.possiblyRequiredCount !== next.possiblyRequiredCount
  );
};

// ─── Persistence — atomic conditional writes (WF-C / WF-D) ────────────────────

/**
 * WF-C persist: merge the incoming requirements into the form's existing notary
 * state and write via an ATOMIC conditional update guarded on
 * `notarySource = AI_DETECTED` (BR12.2). A concurrent USER_SET edit rejects the
 * write (the user's override wins, FR7.2) — swallowed as a no-op. Any other write
 * error is logged and swallowed (best-effort). Never throws.
 */
export const persistFormNotary = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  formId: string;
  existing: NotaryRequirement[];
  incoming: NotaryRequirement[];
}): Promise<void> => {
  const { orgId, projectId, opportunityId, formId, existing, incoming } = args;
  try {
    const merged = mergeNotaryRequirements(existing ?? [], incoming ?? []);
    await updateRequiredForm({
      orgId,
      projectId,
      opportunityId,
      formId,
      patch: {
        notaryStatus: computeNotaryStatus(merged),
        notaryRequirements: merged,
        notarySource: 'AI_DETECTED',
      },
      guardNotaryAiDetected: true,
    });
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      console.log(`[notary-wiring] form ${formId} notary is USER_SET; skipping AI overwrite`);
      return;
    }
    console.warn(`[notary-wiring] persistFormNotary failed for ${formId}:`, (err as Error)?.message);
  }
};

/**
 * WF-D persist: write the opportunity NotarySummary via an ATOMIC conditional
 * update guarded on `notarySummarySource = AI_DETECTED` (BR10.2). Returns true
 * when the summary was actually persisted, false when the write was rejected
 * (USER_SET, the opportunity is missing, or the `expectedPrior` guard tripped)
 * or errored. The notification in the rollup fires only on a `true` return, so a
 * USER_SET summary never triggers a notification. Never throws.
 *
 * `expectedPrior` is the optimistic-concurrency guard for the rollup's
 * notification change-guard (BR11.2): the caller passes the exact prior summary
 * its notify decision compared against (null = it read no stored summary), and
 * the write fails if a CONCURRENT rollup persisted in between — so two rollups
 * that both read prior=null can never both notify. `undefined` skips the guard
 * (degraded read-failure path).
 */
export const persistOpportunityNotarySummary = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  summary: NotarySummary;
  expectedPrior?: NotarySummary | null;
}): Promise<boolean> => {
  const { orgId, projectId, oppId, summary, expectedPrior } = args;
  const priorGuard =
    expectedPrior === undefined
      ? ''
      : expectedPrior === null
        ? ' AND (attribute_not_exists(#ns) OR #ns = :prior)'
        : ' AND #ns = :prior';
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: requireEnv('DB_TABLE_NAME'),
        Key: { [PK_NAME]: OPPORTUNITY_PK, [SK_NAME]: buildOpportunitySk(orgId, projectId, oppId) },
        UpdateExpression: 'SET #ns = :summary, #nss = :ai, #updatedAt = :now',
        ConditionExpression:
          'attribute_exists(#pk) AND attribute_exists(#sk) AND (attribute_not_exists(#nss) OR #nss = :ai)' +
          priorGuard,
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
          '#ns': 'notarySummary',
          '#nss': 'notarySummarySource',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':summary': summary,
          ':ai': 'AI_DETECTED' satisfies NotaryClassificationSource,
          ':now': nowIso(),
          ...(expectedPrior === undefined ? {} : { ':prior': expectedPrior }),
        },
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      console.log(
        `[notary-wiring] opportunity ${oppId} summary write rejected (USER_SET, missing, or a concurrent rollup won); skipping`,
      );
      return false;
    }
    console.warn(
      `[notary-wiring] persistOpportunityNotarySummary failed for ${oppId}:`,
      (err as Error)?.message,
    );
    return false;
  }
};

/**
 * Persist the body scan's UNMAPPED solicitation-instruction notary triggers to the
 * opportunity's `notaryUnmappedTriggers` store (BR10.3). A generic mention ("all
 * certifications must be notarized") that maps to no specific form must survive the
 * async gap on a MIXED opportunity — inline forms already READY, PDF forms still
 * pending — so the FINAL rollup (fired by the last markFormsReadyIfAllDone, which on
 * a mixed opportunity is the Textract callback carrying NO passed-in triggers) still
 * folds it in. Passing the triggers only as a function argument through
 * markFormsReadyIfAllDone does not survive that gap; this durable store does.
 *
 * The store is AI-detected evidence: the incoming triggers are merged (strongest
 * signal, deduped by natural key) with any already-stored triggers — so multiple
 * body scans across the opportunity's documents accumulate, and re-running the same
 * scan converges idempotently — and written via the SAME atomic conditional guard on
 * `notarySummarySource = AI_DETECTED` as the summary (BR10.2): once a user takes
 * manual control of the opportunity notary summary (USER_SET), AI evidence stops
 * mutating it.
 *
 * Concurrency: each document of an opportunity runs its own Step Function
 * execution, so two body scans can race on this one attribute. A plain
 * read-merge-write would let the last writer drop the other's trigger (a BR10.3
 * zero-miss violation), so the write is ALSO conditioned on the exact stored
 * value the merge started from; a loser re-reads, re-merges, and retries.
 * Best-effort; never throws.
 */
const MAX_UNMAPPED_TRIGGER_WRITE_ATTEMPTS = 3;

export const persistOpportunityUnmappedTriggers = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  triggers: NotaryRequirement[];
}): Promise<void> => {
  const { orgId, projectId, oppId, triggers } = args;
  if (!triggers || triggers.length === 0) return;
  try {
    for (let attempt = 1; attempt <= MAX_UNMAPPED_TRIGGER_WRITE_ATTEMPTS; attempt++) {
      let existing: NotaryRequirement[] | null = null; // null = read failed
      try {
        const opp = await getOpportunity({ orgId, projectId, oppId });
        if (opp?.item?.notarySummarySource === ('USER_SET' satisfies NotaryClassificationSource)) {
          console.log(
            `[notary-wiring] opportunity ${oppId} notarySummary is USER_SET; skipping unmapped-trigger persist`,
          );
          return;
        }
        existing = opp?.item?.notaryUnmappedTriggers ?? [];
      } catch (err) {
        // A read failure just means we can't union with prior evidence — still write
        // the current triggers, guarded on USER_SET only (the rollup recomputes
        // wholesale on the next event). This degraded path re-opens the lost-update
        // window, but only while DynamoDB reads are already failing.
        console.warn(
          `[notary-wiring] unmapped-triggers: failed reading opportunity ${oppId}:`,
          (err as Error)?.message,
        );
      }

      const merged = mergeNotaryRequirements(existing ?? [], triggers);
      // Converged — the store already holds every incoming trigger (this scan
      // re-ran, or a concurrent writer folded us in). Nothing to write.
      if (existing !== null && JSON.stringify(mergeNotaryRequirements(existing, [])) === JSON.stringify(merged)) {
        return;
      }

      const storeGuard =
        existing === null
          ? ''
          : existing.length === 0
            ? ' AND (attribute_not_exists(#nut) OR #nut = :prev)'
            : ' AND #nut = :prev';

      try {
        await docClient.send(
          new UpdateCommand({
            TableName: requireEnv('DB_TABLE_NAME'),
            Key: { [PK_NAME]: OPPORTUNITY_PK, [SK_NAME]: buildOpportunitySk(orgId, projectId, oppId) },
            UpdateExpression: 'SET #nut = :triggers, #updatedAt = :now',
            ConditionExpression:
              'attribute_exists(#pk) AND attribute_exists(#sk) AND (attribute_not_exists(#nss) OR #nss = :ai)' +
              storeGuard,
            ExpressionAttributeNames: {
              '#pk': PK_NAME,
              '#sk': SK_NAME,
              '#nut': 'notaryUnmappedTriggers',
              '#nss': 'notarySummarySource',
              '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':triggers': merged,
              ':ai': 'AI_DETECTED' satisfies NotaryClassificationSource,
              ':now': nowIso(),
              ...(existing === null ? {} : { ':prev': existing }),
            },
          }),
        );
        return;
      } catch (err) {
        if (isConditionalCheckFailed(err)) {
          // Either USER_SET (detected on the next read, which then skips) or a
          // concurrent writer changed the store between our read and write —
          // re-read and re-merge so its evidence is never overwritten (BR10.3).
          continue;
        }
        console.warn(
          `[notary-wiring] persistOpportunityUnmappedTriggers failed for ${oppId}:`,
          (err as Error)?.message,
        );
        return;
      }
    }
    console.warn(
      `[notary-wiring] persistOpportunityUnmappedTriggers: gave up after ${MAX_UNMAPPED_TRIGGER_WRITE_ATTEMPTS} contended attempts for ${oppId}`,
    );
  } catch (err) {
    // Last-resort bulkhead — this persist is best-effort and never fails its caller.
    console.warn(
      `[notary-wiring] persistOpportunityUnmappedTriggers failed for ${oppId}:`,
      (err as Error)?.message,
    );
  }
};

// ─── Orchestration — the hook entry points ────────────────────────────────────

/**
 * WF-A: run the solicitation-body notary scan and persist per-mapped-form state.
 *
 * Lists the opportunity's forms, builds SOLICITATION_BODY (+ FORM_FIELD) segments,
 * calls the u1 engine (signalling truncation when the detection scan was capped),
 * maps hits to forms, and persists each mapped form's notary state. Returns the
 * unmapped triggers for the opportunity rollup. Best-effort and zero-miss: a
 * u2-side failure that prevents the engine from running for the forms that WERE
 * to be scanned records a POSSIBLY_REQUIRED review-manually requirement for each
 * (BR7.3) rather than leaving them at the clean NOT_REQUIRED default. Never throws.
 */
export const runBodyNotaryScanAndPersist = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  docText: string;
  solicitationDocName: string;
  truncated: boolean;
}): Promise<NotaryRequirement[]> => {
  const { orgId, projectId, opportunityId, docText, solicitationDocName, truncated } = args;

  let forms: RequiredFormDBItem[] = [];
  try {
    forms = await listRequiredFormsByOpportunity({ orgId, projectId, opportunityId });
  } catch (err) {
    console.warn('[notary-wiring] body scan: failed listing forms:', (err as Error)?.message);
    return [];
  }

  try {
    const segments = buildSolicitationSegments(docText, solicitationDocName, forms);
    const truncatedDocuments = truncated ? [solicitationDocName?.trim() ? solicitationDocName : 'solicitation'] : [];
    const requirements = await detectNotaryRequirements({
      orgId,
      modelId: getNotaryModelId(),
      segments,
      truncatedDocuments,
    });

    const { byFormId, unmapped } = mapRequirementsToForms(requirements, forms);
    for (const form of forms) {
      const incoming = byFormId.get(form.formId) ?? [];
      // A genuinely empty scan for a form is legitimately NOT_REQUIRED — only a
      // FAILED scan (below) forces the review-manually fallback (BR7.3).
      if (incoming.length === 0) continue;
      await persistFormNotary({
        orgId,
        projectId,
        opportunityId,
        formId: form.formId,
        existing: form.notaryRequirements ?? [],
        incoming,
      });
    }
    // Persist the unmapped generic triggers to the opportunity NOW (best-effort), so
    // they survive the async gap on a mixed opportunity and reach the final rollup —
    // regardless of which markFormsReadyIfAllDone call fires last (BR10.3). The
    // return value still feeds the same-handler rollup for pure-inline opportunities.
    await persistOpportunityUnmappedTriggers({ orgId, projectId, oppId: opportunityId, triggers: unmapped });
    return unmapped;
  } catch (err) {
    // u2-side failure (e.g. model-id env unset, segment build error) around the
    // engine call → POSSIBLY_REQUIRED review-manually for every form to be
    // scanned; never a silent NOT_REQUIRED (BR7.3 / NFR1).
    console.warn(
      '[notary-wiring] body notary scan failed; marking scanned forms POSSIBLY_REQUIRED review-manually:',
      (err as Error)?.message,
    );
    for (const form of forms) {
      await persistFormNotary({
        orgId,
        projectId,
        opportunityId,
        formId: form.formId,
        existing: form.notaryRequirements ?? [],
        incoming: [buildReviewManuallyRequirement(form.name, form.formId)],
      });
    }
    return [];
  }
};

/**
 * WF-B: scan a PDF form's Textract page blocks and return the notary patch fields
 * to fold into the READY write (one write). Merges the engine result with the
 * form's existing notary state (BR8.2). Fail-open: a scan error never blocks
 * READY — a u2-side scan failure yields a POSSIBLY_REQUIRED review-manually
 * requirement (BR8.3), and a u1 engine error already yields POSSIBLY_REQUIRED
 * (u1 BR3.1). Never a silent NOT_REQUIRED; never throws.
 */
export const scanFormPageNotary = async (args: {
  orgId: string;
  form: FormLike;
  blocks: TextractBlockLike[];
}): Promise<{
  notaryStatus: NotaryStatus;
  notaryRequirements: NotaryRequirement[];
  notarySource: NotaryClassificationSource;
}> => {
  const { orgId, form, blocks } = args;
  let merged: NotaryRequirement[];
  try {
    const segments = buildFormPageSegments(blocks, form);
    const incoming = await detectNotaryRequirements({ orgId, modelId: getNotaryModelId(), segments });
    merged = mergeNotaryRequirements(form.notaryRequirements ?? [], incoming);
  } catch (err) {
    console.warn(
      `[notary-wiring] form-page scan failed for ${form.formId}; POSSIBLY_REQUIRED review-manually:`,
      (err as Error)?.message,
    );
    merged = mergeNotaryRequirements(form.notaryRequirements ?? [], [
      buildReviewManuallyRequirement(form.name, form.formId),
    ]);
  }
  return { notaryStatus: computeNotaryStatus(merged), notaryRequirements: merged, notarySource: 'AI_DETECTED' };
};

/**
 * WF-D: compute the opportunity NotarySummary, persist it via the atomic
 * conditional write, and fire at most ONE change-guarded notification.
 *
 * The notification fires only when the summary was actually persisted (not
 * rejected by a USER_SET guard), anyNotaryRequired is true, and a notary-material
 * field changed vs. the stored prior summary (BR11). The persist is conditioned
 * on that same prior (optimistic concurrency), so concurrent rollups can never
 * both see prior=null and double-notify — the loser retries against the winner's
 * summary and the change-guard suppresses its send. Recipients are the deduped
 * assignee + createdBy (NFR5.8); the payload is counts-only (leak-free, NFR5.7).
 * Emits one counts-only `notary-rollup` log line. Best-effort; never throws.
 */
const MAX_ROLLUP_PERSIST_ATTEMPTS = 3;

export const rollupOpportunityNotary = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  forms: FormLike[];
  unmappedTriggers?: NotaryRequirement[];
  /**
   * When false, recompute + persist the summary but never send the
   * NOTARY_REQUIRED notification. Used by the manual-override handler: the
   * user just changed the status themselves, so notifying them (or the org)
   * about their own edit is noise. Default true (detection paths notify).
   */
  notify?: boolean;
}): Promise<void> => {
  const { orgId, projectId, oppId, forms, unmappedTriggers = [], notify = true } = args;

  let prior: NotarySummary | null | undefined;
  let assigneeId: string | undefined;
  let createdBy: string | undefined;
  let summary: NotarySummary = summarizeNotary(forms, unmappedTriggers);
  let persisted = false;

  // Read → persist under an optimistic guard on the exact prior we read. Two
  // concurrent rollups (e.g. Textract callbacks for the last two PDF forms) could
  // otherwise BOTH read prior=null and BOTH notify; with the guard the loser's
  // write fails, it re-reads the winner's summary as the fresh prior, and the
  // material-change guard then dedups the notification (BR11.2).
  for (let attempt = 1; attempt <= MAX_ROLLUP_PERSIST_ATTEMPTS; attempt++) {
    let readOk = false;
    let storedUnmapped: NotaryRequirement[] = [];
    prior = undefined;
    try {
      const opp = await getOpportunity({ orgId, projectId, oppId });
      if (opp?.item?.notarySummarySource === ('USER_SET' satisfies NotaryClassificationSource)) {
        // The user owns the summary — the guarded write below would only be
        // rejected; skip it (and the notification) outright.
        console.log(`[notary-wiring] opportunity ${oppId} notarySummary is USER_SET; skipping rollup persist`);
        break;
      }
      prior = opp?.item?.notarySummary ?? null;
      assigneeId = opp?.item?.assigneeId ?? undefined;
      createdBy = opp?.item?.createdBy ?? undefined;
      storedUnmapped = opp?.item?.notaryUnmappedTriggers ?? [];
      readOk = true;
    } catch (err) {
      console.warn(`[notary-wiring] rollup: failed reading opportunity ${oppId}:`, (err as Error)?.message);
    }

    // Fold BOTH the passed-in triggers (the body-scan call in the same handler) AND
    // the opportunity's persisted store (which survives the async gap on a mixed
    // opportunity) into the summary — deduped by natural key so a trigger present in
    // both is counted once. This makes the rollup correct regardless of which
    // markFormsReadyIfAllDone call fires last: the body-scan call OR the final
    // Textract callback (which passes no triggers). Zero-miss (BR10.3 / NFR1).
    const combinedTriggers = mergeNotaryRequirements(storedUnmapped, unmappedTriggers);
    summary = summarizeNotary(forms, combinedTriggers);

    persisted = await persistOpportunityNotarySummary({
      orgId,
      projectId,
      oppId,
      summary,
      // Read-failure path can't guard on a prior it never saw — persist best-effort.
      expectedPrior: readOk ? prior : undefined,
    });
    if (persisted) break;
    // Rejected: USER_SET (the next read detects it and breaks) or a concurrent
    // rollup persisted between our read and write (the next read picks up its
    // summary as the fresh prior). Hard errors just exhaust the bounded retries.
  }

  const shouldNotify =
    notify && persisted && summary.anyNotaryRequired && notarySummaryMaterialChanged(prior, summary);

  if (shouldNotify) {
    let recipients = Array.from(
      new Set([assigneeId, createdBy].filter((id): id is string => typeof id === 'string' && id.length > 0)),
    );
    if (recipients.length === 0) {
      // Legacy opportunities (created before createdBy was recorded, and never
      // assigned) carry NO owner — without a fallback the notification is
      // silently skipped. Fall back to the org membership, the same recipient
      // resolution FOIA_BLOCKED uses. Best-effort: a members-lookup failure
      // degrades to no notification, never a thrown rollup.
      try {
        recipients = (await getOrgMembers(orgId)).map((m) => m.userId);
      } catch (err) {
        console.warn(
          `[notary-wiring] rollup: org-members fallback failed for ${oppId}:`,
          (err as Error)?.message,
        );
      }
    }
    if (recipients.length > 0) {
      // Counts are per-form (≤ totalFormsConsidered). When no individual form is
      // flagged, anyNotaryRequired came from a solicitation-level instruction —
      // word the message accordingly instead of "0 of N form(s)".
      const flagged = summary.requiredCount + summary.possiblyRequiredCount;
      const message =
        flagged > 0
          ? `${flagged} of ${summary.totalFormsConsidered} form(s) in this opportunity may require notarization. Review before submission.`
          : 'The solicitation for this opportunity contains notarization requirements. Review before submission.';
      await sendNotification(
        buildNotification(
          'NOTARY_REQUIRED',
          'Notary requirement detected',
          message,
          { orgId, projectId, recipientUserIds: recipients, entityId: oppId },
        ),
      );
    }
  }

  // One counts-only tuning line (leak-free — no document text, NFR5.7).
  console.log(
    JSON.stringify({
      tag: 'notary-rollup',
      oppId,
      anyNotaryRequired: summary.anyNotaryRequired,
      requiredCount: summary.requiredCount,
      possiblyRequiredCount: summary.possiblyRequiredCount,
      totalFormsConsidered: summary.totalFormsConsidered,
      persisted,
      notified: shouldNotify,
    }),
  );
};

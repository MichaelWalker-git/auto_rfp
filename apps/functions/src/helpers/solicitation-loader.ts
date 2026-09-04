/**
 * solicitation-loader.ts
 *
 * Decides, at load time, how the Solution Plan sees the merged solicitation
 * text (docs/SOLICITATION-COVERAGE-PLAN.md). Additive to `loadSolicitation` /
 * `loadAllSolicitationTexts` — every other caller of those keeps the plain
 * `string` behavior untouched; only the Solution Plan uses `SolicitationBundle`.
 */

import type { DocSummary, SolicitationBundle } from '@auto-rfp/core';

import {
  applyPerDocumentBudget,
  loadRawSolicitationDocuments,
  mergeSolicitationDocuments,
  type RawSolicitationDoc,
} from './executive-opportunity-brief';
import { updateQuestionFile } from './questionFile';
import { summarizeSolicitationDocument } from './solicitation-summary';

const DEFAULT_FULL_THRESHOLD_CHARS = 150_000;

/** `SOLUTION_PLAN_FULL_SOLICITATION_THRESHOLD_CHARS`, default 150,000. */
export const resolveFullSolicitationThresholdChars = (): number => {
  const raw = Number(process.env.SOLUTION_PLAN_FULL_SOLICITATION_THRESHOLD_CHARS ?? DEFAULT_FULL_THRESHOLD_CHARS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_FULL_THRESHOLD_CHARS;
};

/**
 * Master switch for the hybrid routing (rollout gate). Off means every RFP
 * gets the `FULL` strategy regardless of size — still budget-floored and
 * raised-cap, just never routed to `SUMMARIZED`.
 */
const isHybridSolicitationEnabled = (): boolean => process.env.SOLUTION_PLAN_HYBRID_SOLICITATION === '1';

const EMPTY_BUNDLE: SolicitationBundle = { strategy: 'FULL', text: '', documents: [] };

const buildFullBundle = (docs: RawSolicitationDoc[], maxChars: number): SolicitationBundle => {
  const budgeted = applyPerDocumentBudget(docs, maxChars);
  return {
    strategy: 'FULL',
    text: mergeSolicitationDocuments(budgeted),
    documents: budgeted.map((d) => ({ name: d.fileName, chars: d.text.length })),
  };
};

/**
 * Resolve one document's summary: reuse the cached `QuestionFileItem.summary`
 * / `.sections` when present (extraction-time hook — not wired in this PR),
 * otherwise summarize now and best-effort persist the result so later runs
 * don't pay for it again. Persist failures never fail the plan (logged only).
 */
const getOrCreateDocSummary = async (orgId: string, doc: RawSolicitationDoc): Promise<DocSummary> => {
  const { file, fileName, text } = doc;

  if (file.summary && file.sections) {
    return { name: fileName, chars: text.length, summary: file.summary, sections: file.sections };
  }

  const { summary, sections } = await summarizeSolicitationDocument(orgId, file, text);

  if (file.projectId && file.oppId && file.questionFileId) {
    updateQuestionFile(file.projectId, file.oppId, file.questionFileId, { summary, sections }).catch((err) =>
      console.warn(
        `[loadSolicitationBundle] Failed to persist summary for ${fileName}:`,
        (err as Error)?.message,
      ),
    );
  }

  return { name: fileName, chars: text.length, summary, sections };
};

/**
 * Route on total merged raw text size (docs/SOLICITATION-COVERAGE-PLAN.md):
 *
 *  - `FULL` — at or under the threshold (or the hybrid flag is off): the
 *    whole solicitation, per-document budget floored at the threshold.
 *  - `SUMMARIZED` — over the threshold: per-document summaries + a manifest;
 *    detail comes via `fetch_solicitation_section`.
 */
export const loadSolicitationBundle = async (
  projectId: string,
  opportunityId: string,
  orgId: string,
): Promise<SolicitationBundle> => {
  const docs = await loadRawSolicitationDocuments(projectId, opportunityId);
  if (!docs.length) return EMPTY_BUNDLE;

  const threshold = resolveFullSolicitationThresholdChars();
  const totalChars = docs.reduce((sum, d) => sum + d.text.length, 0);

  if (!isHybridSolicitationEnabled() || totalChars <= threshold) {
    return buildFullBundle(docs, threshold);
  }

  console.log(
    `[loadSolicitationBundle] ${totalChars} chars > ${threshold} threshold — using SUMMARIZED strategy for ${docs.length} document(s)`,
  );
  const summaries = await Promise.all(docs.map((doc) => getOrCreateDocSummary(orgId, doc)));
  return { strategy: 'SUMMARIZED', summaries, totalChars };
};

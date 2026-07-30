import {
  OPPORTUNITY_STATUS_LABELS,
  OPPORTUNITY_APPROVAL_LABELS,
} from '@auto-rfp/core';
import type {
  RfpPipelineItem,
  OpportunityStatusTransition,
  OpportunityApprovalTransition,
} from '@auto-rfp/core';

/**
 * A single, presentation-ready entry in the merged transition timeline. The
 * `kind` discriminates a pipeline-status change from an approval-gate change so
 * the panel can label / icon each accordingly.
 */
export interface TimelineEntry {
  kind: 'status' | 'approval';
  /** ISO timestamp of the change — drives both the absolute and relative display. */
  changedAt: string;
  /** Actor label, already humanized ('system' → 'System'). */
  actor: string;
  /** e.g. "Status: Pursuing → Submitted" or "Approval: I Approved → Pre Sub Approval". */
  label: string;
  /** The `from` side, humanized. `null` when this is the initial entry. */
  fromLabel: string | null;
  /** The `to` side, humanized. */
  toLabel: string;
  /** Optional free-text reason recorded with the transition. */
  reason?: string;
}

/** 'system' (the sync/actor sentinel) reads as "System"; everything else is verbatim. */
const formatActor = (changedBy: string): string =>
  changedBy === 'system' ? 'System' : changedBy;

const statusEntry = (t: OpportunityStatusTransition): TimelineEntry => {
  const fromLabel = t.from ? OPPORTUNITY_STATUS_LABELS[t.from] : null;
  const toLabel = OPPORTUNITY_STATUS_LABELS[t.to];
  return {
    kind: 'status',
    changedAt: t.changedAt,
    actor: formatActor(t.changedBy),
    fromLabel,
    toLabel,
    label: `Status: ${fromLabel ? `${fromLabel} → ` : '→ '}${toLabel}`,
    reason: t.reason,
  };
};

const approvalEntry = (t: OpportunityApprovalTransition): TimelineEntry => {
  const fromLabel = t.from ? OPPORTUNITY_APPROVAL_LABELS[t.from] : null;
  const toLabel = OPPORTUNITY_APPROVAL_LABELS[t.to];
  return {
    kind: 'approval',
    changedAt: t.changedAt,
    actor: formatActor(t.changedBy),
    fromLabel,
    toLabel,
    label: `Approval: ${fromLabel ? `${fromLabel} → ` : '→ '}${toLabel}`,
    reason: t.reason,
  };
};

/**
 * Merge an item's `statusHistory` and `approvalHistory` into a single timeline,
 * sorted by `changedAt` DESCENDING (most recent first). Pure and side-effect
 * free — the detail panel renders whatever this returns. Missing histories are
 * treated as empty; the result is `[]` when neither has entries.
 */
export const buildTransitionTimeline = (item: RfpPipelineItem): TimelineEntry[] => {
  const statusEntries = (item.statusHistory ?? []).map(statusEntry);
  const approvalEntries = (item.approvalHistory ?? []).map(approvalEntry);

  return [...statusEntries, ...approvalEntries].sort(
    (a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt),
  );
};

import type { RfpPipelineItem, OpportunityApprovalStatus } from '@auto-rfp/core';
import {
  deadlineUrgency,
  entryIntoCurrentStageIso,
  resolveApprovalStatus,
  type DeadlineUrgency,
} from './derive-board';

export interface ApprovalQueueEntry {
  item: RfpPipelineItem;
  enteredStageIso: string | null;
  daysWaiting: number | null;
  deadlineUrgency: DeadlineUrgency;
  daysToDeadline: number | null;
}

export interface PendingApprovalCount {
  initial: number;
  final: number;
  total: number;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const daysSince = (fromIso: string | null, nowIso: string): number | null => {
  if (!fromIso) return null;
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(from) || Number.isNaN(now)) return null;
  return Math.floor((now - from) / MS_PER_DAY);
};

/** Items in a given approval stage, oldest-first (longest-waiting at the top). */
const deriveQueueForStage = (
  items: RfpPipelineItem[],
  stage: OpportunityApprovalStatus,
  nowIso: string,
): ApprovalQueueEntry[] =>
  items
    .filter((item) => resolveApprovalStatus(item) === stage)
    .map((item) => {
      const enteredStageIso = entryIntoCurrentStageIso(item);
      const { urgency, daysToDeadline } = deadlineUrgency(item.responseDeadlineIso, nowIso);
      return {
        item,
        enteredStageIso,
        daysWaiting: daysSince(enteredStageIso, nowIso),
        deadlineUrgency: urgency,
        daysToDeadline,
      };
    })
    .sort((a, b) => {
      // Oldest entry first; unknown entry times sink to the bottom.
      const at = a.enteredStageIso ? Date.parse(a.enteredStageIso) : Number.POSITIVE_INFINITY;
      const bt = b.enteredStageIso ? Date.parse(b.enteredStageIso) : Number.POSITIVE_INFINITY;
      return at - bt;
    });

/** Gate-1 queue: opportunities awaiting Initial Approval (Brennen's queue). */
export const deriveInitialQueue = (items: RfpPipelineItem[], nowIso: string): ApprovalQueueEntry[] =>
  deriveQueueForStage(items, 'INITIAL_APPROVAL', nowIso);

/** Gate-2 queue: opportunities awaiting Pre-Submission Approval (Michael's queue). */
export const deriveFinalQueue = (items: RfpPipelineItem[], nowIso: string): ApprovalQueueEntry[] =>
  deriveQueueForStage(items, 'PRE_SUB_APPROVAL', nowIso);

/** Pending counts per gate + total. The sidebar badge uses `total`. */
export const pendingApprovalCount = (items: RfpPipelineItem[]): PendingApprovalCount => {
  let initial = 0;
  let final = 0;
  for (const item of items) {
    const stage = resolveApprovalStatus(item);
    if (stage === 'INITIAL_APPROVAL') initial++;
    else if (stage === 'PRE_SUB_APPROVAL') final++;
  }
  return { initial, final, total: initial + final };
};

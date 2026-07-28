import type { RfpPipelineItem, OpportunityApprovalStatus } from '@auto-rfp/core';

export type DeadlineUrgency = 'none' | 'safe' | 'soon' | 'urgent' | 'overdue';

export interface BoardCard {
  item: RfpPipelineItem;
  approvalStatus: OpportunityApprovalStatus;
  daysInCurrentStage: number | null;
  deadlineUrgency: DeadlineUrgency;
  daysToDeadline: number | null;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Whole days between two ISO timestamps (a → b), or null if either is unusable. */
const daysBetween = (fromIso: string | null | undefined, toIso: string | null | undefined): number | null => {
  if (!fromIso || !toIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.floor((to - from) / MS_PER_DAY);
};

/** The approval status an item sits in, defaulting missing → INITIAL_APPROVAL. */
export const resolveApprovalStatus = (item: RfpPipelineItem): OpportunityApprovalStatus =>
  item.approvalStatus ?? 'INITIAL_APPROVAL';

/**
 * When did the item enter its current approval stage? The last approvalHistory
 * entry whose `to` matches the current approvalStatus wins; otherwise fall back
 * to statusHistory's latest change, then updatedAt/createdAt.
 */
export const entryIntoCurrentStageIso = (item: RfpPipelineItem): string | null => {
  const approvalStatus = resolveApprovalStatus(item);

  const approvalHistory = item.approvalHistory ?? [];
  for (let i = approvalHistory.length - 1; i >= 0; i--) {
    if (approvalHistory[i]!.to === approvalStatus) return approvalHistory[i]!.changedAt;
  }

  const statusHistory = item.statusHistory ?? [];
  const lastStatus = statusHistory[statusHistory.length - 1];
  if (lastStatus) return lastStatus.changedAt;

  return item.updatedAt ?? item.createdAt ?? null;
};

/** Deadline urgency bucket: overdue/≤2d = urgent, ≤7d = soon, else safe. */
export const deadlineUrgency = (
  responseDeadlineIso: string | null | undefined,
  nowIso: string,
): { urgency: DeadlineUrgency; daysToDeadline: number | null } => {
  const days = daysBetween(nowIso, responseDeadlineIso);
  if (days === null) return { urgency: 'none', daysToDeadline: null };
  if (days < 0) return { urgency: 'overdue', daysToDeadline: days };
  if (days <= 2) return { urgency: 'urgent', daysToDeadline: days };
  if (days <= 7) return { urgency: 'soon', daysToDeadline: days };
  return { urgency: 'safe', daysToDeadline: days };
};

export const toBoardCard = (item: RfpPipelineItem, nowIso: string): BoardCard => {
  const approvalStatus = resolveApprovalStatus(item);
  const entryIso = entryIntoCurrentStageIso(item);
  const { urgency, daysToDeadline } = deadlineUrgency(item.responseDeadlineIso, nowIso);

  return {
    item,
    approvalStatus,
    daysInCurrentStage: daysBetween(entryIso, nowIso),
    deadlineUrgency: urgency,
    daysToDeadline,
  };
};

/** Group items into an approvalStatus → cards map. Empty stages get an empty array. */
export const groupByApprovalStatus = (
  items: RfpPipelineItem[],
  statuses: OpportunityApprovalStatus[],
  nowIso: string,
): Record<OpportunityApprovalStatus, BoardCard[]> => {
  const grouped = Object.fromEntries(statuses.map((s) => [s, [] as BoardCard[]])) as Record<
    OpportunityApprovalStatus,
    BoardCard[]
  >;

  for (const item of items) {
    const card = toBoardCard(item, nowIso);
    if (grouped[card.approvalStatus]) grouped[card.approvalStatus].push(card);
  }

  return grouped;
};

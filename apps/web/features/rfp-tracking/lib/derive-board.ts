import type { RfpPipelineItem, RfpPipelineStage, OpportunityApprovalStatus } from '@auto-rfp/core';

export type DeadlineUrgency = 'none' | 'safe' | 'soon' | 'urgent' | 'overdue';

export interface BoardCard {
  item: RfpPipelineItem;
  /** The Linear-mirroring board stage this card sits in. */
  stage: RfpPipelineStage;
  /** The two-gate approval axis — retained for the stage-advance actions. */
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

/** The board stage an item sits in, defaulting missing → found. */
export const resolveStage = (item: RfpPipelineItem): RfpPipelineStage =>
  item.pipelineStage ?? 'found';

/**
 * When did the item enter its current stage? The last approvalHistory entry
 * whose `to` matches the current approvalStatus wins (that's when the sync last
 * moved it); otherwise fall back to statusHistory's latest change, then
 * updatedAt/createdAt.
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
  const stage = resolveStage(item);
  const entryIso = entryIntoCurrentStageIso(item);
  const { urgency, daysToDeadline } = deadlineUrgency(item.responseDeadlineIso, nowIso);

  return {
    item,
    stage,
    approvalStatus,
    daysInCurrentStage: daysBetween(entryIso, nowIso),
    deadlineUrgency: urgency,
    daysToDeadline,
  };
};

/** Group items into a stage → cards map. Empty stages get an empty array. */
export const groupByStage = (
  items: RfpPipelineItem[],
  stages: RfpPipelineStage[],
  nowIso: string,
): Record<RfpPipelineStage, BoardCard[]> => {
  const grouped = Object.fromEntries(stages.map((s) => [s, [] as BoardCard[]])) as Record<
    RfpPipelineStage,
    BoardCard[]
  >;

  for (const item of items) {
    const card = toBoardCard(item, nowIso);
    if (grouped[card.stage]) grouped[card.stage].push(card);
  }

  return grouped;
};

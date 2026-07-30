import type { RfpPipelineItem, RfpPipelineStage, OpportunityApprovalStatus } from '@auto-rfp/core';

export type DeadlineUrgency = 'none' | 'safe' | 'soon' | 'urgent' | 'overdue';

export interface BoardCard {
  item: RfpPipelineItem;
  /** The Linear-mirroring board stage this card sits in. */
  stage: RfpPipelineStage;
  /** The two-gate approval axis — retained for the stage-advance actions. */
  approvalStatus: OpportunityApprovalStatus;
  /**
   * Whole days since the item's last APPROVAL-axis move (or last update if the
   * approval axis is untouched) — NOT the age in the board `stage`. See
   * entryIntoCurrentStageIso. Name kept for backward compatibility with
   * consumers owned outside this file.
   */
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

/**
 * Whole CALENDAR days between two ISO timestamps (a → b), measured on the UTC
 * date boundary, or null if either is unusable. Unlike `daysBetween` (which
 * floors a raw ms delta and so drifts with the wall-clock time of day), this
 * floors both timestamps to UTC midnight first — so urgency is stable across the
 * day and "overdue" flips the moment the UTC calendar date passes the deadline.
 */
const calendarDaysBetween = (
  fromIso: string | null | undefined,
  toIso: string | null | undefined,
): number | null => {
  if (!fromIso || !toIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  const fromMidnight = Math.floor(from / MS_PER_DAY);
  const toMidnight = Math.floor(to / MS_PER_DAY);
  return toMidnight - fromMidnight;
};

/** The approval status an item sits in, defaulting missing → INITIAL_APPROVAL. */
export const resolveApprovalStatus = (item: RfpPipelineItem): OpportunityApprovalStatus =>
  item.approvalStatus ?? 'INITIAL_APPROVAL';

/**
 * The board stage an item sits in. Missing stage → execSummaryToReview (the
 * first visible column) so a record without a synced stage still appears rather
 * than landing in the hidden `found` bucket.
 */
export const resolveStage = (item: RfpPipelineItem): RfpPipelineStage =>
  item.pipelineStage ?? 'execSummaryToReview';

/**
 * The timestamp of the item's most recent move on the APPROVAL axis (or, failing
 * that, the last status change / updatedAt / createdAt).
 *
 * IMPORTANT: this measures the *approval-axis* age, NOT the board-stage
 * (`pipelineStage`) age. The approvalHistory entry whose `to` matches the current
 * approvalStatus wins (that's when the approval gate last moved the item). There
 * is no per-`pipelineStage` history array on the item, so a truthful
 * board-stage-entry time cannot be reconstructed here — for Linear-synced records
 * whose approval axis is untouched, all fallbacks resolve to updatedAt (i.e.
 * "time since last update"). Callers deriving `daysInCurrentStage` should treat
 * the result as approval-axis / last-update age, not stage-dwell time.
 *
 * Picks the entry with the maximum `changedAt` among matches (not array
 * position), so a backfilled / out-of-order history still resolves the true
 * latest transition — consistent with derive-timeline.ts.
 */
export const entryIntoCurrentStageIso = (item: RfpPipelineItem): string | null => {
  const approvalStatus = resolveApprovalStatus(item);

  const approvalHistory = item.approvalHistory ?? [];
  let latestMatch: string | null = null;
  for (const entry of approvalHistory) {
    if (entry.to !== approvalStatus) continue;
    if (latestMatch === null || Date.parse(entry.changedAt) > Date.parse(latestMatch)) {
      latestMatch = entry.changedAt;
    }
  }
  if (latestMatch !== null) return latestMatch;

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
  // Calendar-day comparison so urgency doesn't drift with the time of day the
  // dashboard loads (e.g. a midnight deadline viewed at 18:00 the prior day, or
  // a 6h-overdue deadline, must not floor to 0 and mislabel).
  const days = calendarDaysBetween(nowIso, responseDeadlineIso);
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
    // NOTE: despite the name, this measures approval-axis / last-update age, NOT
    // the age since the card entered its board `stage`. There is no per-
    // pipelineStage history to reconstruct a true stage-entry time from, so this
    // is derived from entryIntoCurrentStageIso (last approval-gate move, else
    // last status change / updatedAt). See that function's JSDoc. Field name is
    // kept to avoid breaking consumers (components/exports) owned elsewhere.
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

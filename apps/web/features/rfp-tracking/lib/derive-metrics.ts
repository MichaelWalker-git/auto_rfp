import type {
  RfpPipelineItem,
  RfpPipelineStage,
  OpportunityApprovalStatus,
} from '@auto-rfp/core';
import { RFP_STAGE_LABELS } from '@auto-rfp/core';
import { entryIntoCurrentStageIso, resolveStage } from './derive-board';

/**
 * derive-metrics.ts
 *
 * Pure, client-side derivations that power the RFP-tracking METRICS tab. Every
 * function is a pure const-arrow with no side effects, computed from the same
 * `RfpPipelineItem[]` the board/queue/attention tabs already fetch.
 *
 * In-period rules (documented per metric):
 *   - throughput / funnel : count TRANSITION EVENTS whose timestamp falls inside
 *     [startIso, endIso]. An item can contribute to several buckets if it moved
 *     through several stages during the window.
 *   - win rate            : denominator = items SUBMITTED within the window;
 *     numerator = of those, the ones that reached an awarded outcome.
 *   - outcome breakdown   : classify each item by its CURRENT resolved state,
 *     restricted to items active/closed within the window (submitted-in-window
 *     OR still-open snapshot). Documented in `outcomeBreakdown`.
 *   - aging               : a snapshot at `nowIso`, NOT windowed — it answers
 *     "what is stuck right now".
 *   - cycle time          : computed over ALL supplied items (already filtered by
 *     the caller for owner); each stage stat only counts items for which a valid
 *     entry→exit pair can be derived from the histories.
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Whole days between two ISO timestamps (a → b), or null if either is unusable. */
export const daysBetween = (
  fromIso: string | null | undefined,
  toIso: string | null | undefined,
): number | null => {
  if (!fromIso || !toIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.floor((to - from) / MS_PER_DAY);
};

/** Parse an ISO string to epoch ms, or null when unusable. */
const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/** Median of a numeric list (null for an empty list). */
export const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

/** Average of a numeric list (null for an empty list). */
export const average = (values: number[]): number | null => {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
};

// ─── ISO-week bucketing (Monday start) ───────────────────────────────────────

/** The Monday 00:00:00Z that starts the ISO week containing `iso`. */
export const weekStart = (iso: string): Date => {
  const d = new Date(iso);
  // getUTCDay: 0=Sun..6=Sat. Shift so Monday is the week start.
  const day = d.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday),
  );
  return monday;
};

/** Compact week label, e.g. "Jul 21". */
export const weekLabel = (weekStartDate: Date): string =>
  weekStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// ─── Approval-status helpers ─────────────────────────────────────────────────

const AWARDED_STAGES: readonly RfpPipelineStage[] = ['awarded'];
const LOST_STAGES: readonly RfpPipelineStage[] = ['lost'];
const NOT_APPROVED_STAGES: readonly RfpPipelineStage[] = ['notApproved'];

/** Is the given ISO timestamp within [startIso, endIso] inclusive? */
const inWindow = (iso: string | null | undefined, startIso: string, endIso: string): boolean => {
  const ms = parseMs(iso);
  if (ms === null) return false;
  const start = parseMs(startIso);
  const end = parseMs(endIso);
  if (start === null || end === null) return false;
  return ms >= start && ms <= end;
};

/**
 * The ISO timestamp an item entered a SUBMITTED state, or null if none. Prefer
 * the approvalHistory entry `to === 'SUBMITTED'`, then statusHistory
 * `to === 'SUBMITTED'`, then `completedAt` when the current board stage is
 * `submitted`.
 */
export const submittedAtIso = (item: RfpPipelineItem): string | null => {
  const ah = item.approvalHistory ?? [];
  for (let i = ah.length - 1; i >= 0; i--) {
    if (ah[i]!.to === 'SUBMITTED') return ah[i]!.changedAt;
  }
  const sh = item.statusHistory ?? [];
  for (let i = sh.length - 1; i >= 0; i--) {
    if (sh[i]!.to === 'SUBMITTED') return sh[i]!.changedAt;
  }
  if (item.pipelineStage === 'submitted' && item.completedAt) return item.completedAt;
  return null;
};

/** Has the item ever reached a submitted state (approval or status history / stage)? */
const hasSubmitted = (item: RfpPipelineItem): boolean => submittedAtIso(item) !== null;

/** Is the item's current resolved board stage an awarded outcome? */
const isAwarded = (item: RfpPipelineItem): boolean =>
  item.status === 'WON' || AWARDED_STAGES.includes(resolveStage(item));

// ─── Filtering ───────────────────────────────────────────────────────────────

export interface MetricsFilter {
  startIso: string;
  endIso: string;
  /** Optional owner (assigneeId) filter; undefined = all owners. */
  assigneeId?: string;
}

/**
 * Owner-only filter — restricts the working set by assignee. Date-range scoping
 * is applied per metric (each metric decides what "in period" means), so this
 * intentionally does NOT drop items by date; it only narrows by owner.
 */
export const filterItems = (
  items: RfpPipelineItem[],
  { assigneeId }: Pick<MetricsFilter, 'assigneeId'>,
): RfpPipelineItem[] => {
  if (!assigneeId) return items;
  return items.filter((item) => item.assigneeId === assigneeId);
};

// ─── 1. Throughput — submissions per ISO week ────────────────────────────────

export interface ThroughputBucket {
  weekStartIso: string;
  label: string;
  count: number;
}

/**
 * Count of RFPs whose submission event falls in each ISO week (Mon–Sun) within
 * the window. Buckets are dense: every week from the window start to the window
 * end is present, even with a zero count, so the bar chart has no gaps.
 */
export const throughputByWeek = (
  items: RfpPipelineItem[],
  startIso: string,
  endIso: string,
): ThroughputBucket[] => {
  const counts = new Map<string, number>();

  // Seed dense buckets across the window.
  const firstWeek = weekStart(startIso);
  const lastWeek = weekStart(endIso);
  for (
    let cursor = new Date(firstWeek);
    cursor.getTime() <= lastWeek.getTime();
    cursor = new Date(cursor.getTime() + 7 * MS_PER_DAY)
  ) {
    counts.set(cursor.toISOString(), 0);
  }

  for (const item of items) {
    const submitted = submittedAtIso(item);
    if (!inWindow(submitted, startIso, endIso)) continue;
    const key = weekStart(submitted!).toISOString();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([weekStartIso, count]) => ({
      weekStartIso,
      label: weekLabel(new Date(weekStartIso)),
      count,
    }));
};

// ─── 2. Funnel — items entering each canonical stage + conversion ────────────

export interface FunnelRow {
  stage: RfpPipelineStage;
  label: string;
  entered: number;
  /** Conversion % from the previous funnel row (null for the first row). */
  conversionFromPrev: number | null;
}

/**
 * Canonical funnel order chosen to answer "does it take 100 leads to get 1
 * deal?" — the lead-to-deal path: sourced/intake → first approval →
 * pre-submission → submitted → awarded. We deliberately use this linear subset
 * of the board rather than the full 11-stage order (which includes terminal
 * dead-ends like notApproved/lost that would break a monotonic funnel).
 */
export const FUNNEL_STAGE_ORDER: readonly RfpPipelineStage[] = [
  'execSummaryToReview',
  'firstApproved',
  'preSubmissionReview',
  'submitted',
  'awarded',
];

/**
 * The approval-status milestones that map onto each funnel stage. Entry into a
 * funnel stage is detected from EITHER an approvalHistory `to` reaching the
 * milestone OR the item's current board stage being at/at-least that stage.
 */
const FUNNEL_APPROVAL_FOR_STAGE: Partial<Record<RfpPipelineStage, OpportunityApprovalStatus>> = {
  execSummaryToReview: 'INITIAL_APPROVAL',
  firstApproved: 'I_APPROVED',
  preSubmissionReview: 'PRE_SUB_APPROVAL',
  submitted: 'SUBMITTED',
};

/**
 * Did the item enter `stage` within the window? Uses the approvalHistory event
 * log first (the intended source per spec §5); for `awarded` there is no
 * approval milestone, so we fall back to the current stage + completedAt.
 */
const enteredStageInWindow = (
  item: RfpPipelineItem,
  stage: RfpPipelineStage,
  startIso: string,
  endIso: string,
): boolean => {
  if (stage === 'submitted') {
    return inWindow(submittedAtIso(item), startIso, endIso);
  }
  if (stage === 'awarded') {
    if (!isAwarded(item)) return false;
    const at = item.completedAt ?? item.updatedAt ?? null;
    return inWindow(at, startIso, endIso);
  }
  const milestone = FUNNEL_APPROVAL_FOR_STAGE[stage];
  if (!milestone) return false;
  const ah = item.approvalHistory ?? [];
  for (const t of ah) {
    if (t.to === milestone && inWindow(t.changedAt, startIso, endIso)) return true;
  }
  return false;
};

/**
 * Count of items that ENTERED each funnel stage during the window, with the
 * stage-to-stage conversion percentage between consecutive rows.
 */
export const funnel = (
  items: RfpPipelineItem[],
  startIso: string,
  endIso: string,
): FunnelRow[] => {
  const counts = FUNNEL_STAGE_ORDER.map(
    (stage) => items.filter((item) => enteredStageInWindow(item, stage, startIso, endIso)).length,
  );

  return FUNNEL_STAGE_ORDER.map((stage, i) => {
    const entered = counts[i]!;
    const prev = i > 0 ? counts[i - 1]! : null;
    const conversionFromPrev = prev === null ? null : prev === 0 ? 0 : (entered / prev) * 100;
    return {
      stage,
      label: RFP_STAGE_LABELS[stage],
      entered,
      conversionFromPrev,
    };
  });
};

// ─── 3. Cycle time — avg/median days per stage + found-to-submitted ──────────

export interface CycleTimeRow {
  stage: RfpPipelineStage;
  label: string;
  avgDays: number | null;
  medianDays: number | null;
  n: number;
}

export interface CycleTimeSummary {
  perStage: CycleTimeRow[];
  foundToSubmitted: { avgDays: number | null; medianDays: number | null; n: number };
}

/** The approval milestones, in order, whose consecutive gaps are stage durations. */
const CYCLE_APPROVAL_ORDER: readonly OpportunityApprovalStatus[] = [
  'INITIAL_APPROVAL',
  'I_APPROVED',
  'PRE_SUB_APPROVAL',
  'II_APPROVED',
  'SUBMITTED',
];

/** The board stage a given approval milestone "sits in" for labelling purposes. */
const APPROVAL_TO_STAGE: Record<OpportunityApprovalStatus, RfpPipelineStage> = {
  INITIAL_APPROVAL: 'execSummaryToReview',
  I_APPROVED: 'firstApproved',
  PRE_SUB_APPROVAL: 'preSubmissionReview',
  II_APPROVED: 'secondApproved',
  SUBMITTED: 'submitted',
  NOT_APPROVED: 'notApproved',
};

/**
 * The earliest timestamp an item reached a given approval milestone from its
 * approvalHistory, or null. Uses the first matching `to` (entry, not re-entry).
 */
const firstReachedIso = (
  item: RfpPipelineItem,
  milestone: OpportunityApprovalStatus,
): string | null => {
  const ah = item.approvalHistory ?? [];
  for (const t of ah) {
    if (t.to === milestone) return t.changedAt;
  }
  return null;
};

/**
 * Average AND median days spent in each stage, plus the total found-to-submitted
 * duration. Durations derive from the approvalHistory event log: the days
 * between reaching milestone N and milestone N+1. Items with sparse/empty
 * history simply don't contribute to a stage's sample (n reflects the count of
 * items that had a derivable entry→exit pair) — they are never guessed.
 */
export const cycleTime = (items: RfpPipelineItem[]): CycleTimeSummary => {
  const perStageDurations = new Map<RfpPipelineStage, number[]>();
  const foundToSubmitted: number[] = [];

  for (const item of items) {
    // Consecutive-milestone durations → the stage the earlier milestone sat in.
    for (let i = 0; i < CYCLE_APPROVAL_ORDER.length - 1; i++) {
      const fromMilestone = CYCLE_APPROVAL_ORDER[i]!;
      const toMilestone = CYCLE_APPROVAL_ORDER[i + 1]!;
      const days = daysBetween(firstReachedIso(item, fromMilestone), firstReachedIso(item, toMilestone));
      if (days === null || days < 0) continue;
      const stage = APPROVAL_TO_STAGE[fromMilestone];
      const bucket = perStageDurations.get(stage) ?? [];
      bucket.push(days);
      perStageDurations.set(stage, bucket);
    }

    // Total found-to-submitted: first milestone reached → submitted.
    const firstIso =
      firstReachedIso(item, 'INITIAL_APPROVAL') ??
      item.createdAt ??
      entryIntoCurrentStageIso(item);
    const total = daysBetween(firstIso, submittedAtIso(item));
    if (total !== null && total >= 0) foundToSubmitted.push(total);
  }

  const perStage: CycleTimeRow[] = CYCLE_APPROVAL_ORDER.slice(0, -1).map((milestone) => {
    const stage = APPROVAL_TO_STAGE[milestone];
    const durations = perStageDurations.get(stage) ?? [];
    return {
      stage,
      label: RFP_STAGE_LABELS[stage],
      avgDays: average(durations),
      medianDays: median(durations),
      n: durations.length,
    };
  });

  return {
    perStage,
    foundToSubmitted: {
      avgDays: average(foundToSubmitted),
      medianDays: median(foundToSubmitted),
      n: foundToSubmitted.length,
    },
  };
};

// ─── 4. Win rate — awarded / submitted ───────────────────────────────────────

export interface WinRateResult {
  awarded: number;
  submitted: number;
  /** Awarded / submitted as a 0–100 percentage, or null when nothing submitted. */
  rate: number | null;
}

/**
 * Win rate over the window. Denominator = items whose submission event fell in
 * the window; numerator = of those, the ones that reached an awarded outcome.
 */
export const winRate = (
  items: RfpPipelineItem[],
  startIso: string,
  endIso: string,
): WinRateResult => {
  const submittedInWindow = items.filter((item) =>
    inWindow(submittedAtIso(item), startIso, endIso),
  );
  const submitted = submittedInWindow.length;
  const awarded = submittedInWindow.filter(isAwarded).length;
  return { awarded, submitted, rate: submitted === 0 ? null : (awarded / submitted) * 100 };
};

// ─── 5. Outcome breakdown — donut buckets ────────────────────────────────────

export type OutcomeKey = 'awarded' | 'lost' | 'noResponse' | 'pending' | 'notApproved';

export interface OutcomeSlice {
  key: OutcomeKey;
  label: string;
  count: number;
  color: string;
}

const OUTCOME_META: Record<OutcomeKey, { label: string; color: string }> = {
  awarded: { label: 'Awarded', color: '#10b981' },
  lost: { label: 'Lost', color: '#ef4444' },
  noResponse: { label: 'No Response', color: '#94a3b8' },
  pending: { label: 'Pending', color: '#6366f1' },
  notApproved: { label: 'Not Approved', color: '#f59e0b' },
};

/**
 * Classify each item into exactly one outcome bucket (current resolved state):
 *   - Awarded     : status WON or board stage `awarded`.
 *   - Lost        : status LOST or board stage `lost`.
 *   - Not Approved: board stage `notApproved` (gate-1 rejection).
 *   - No Response : status WITHDRAWN/NO_BID, or board stage `expired` — the
 *     "went dark / no response" bucket. (There is no dedicated NO_RESPONSE
 *     status in the model, so this is the closest derivable equivalent.)
 *   - Pending     : anything still open / in-flight (everything else).
 *
 * In-period rule: only items that are either (a) submitted within the window, or
 * (b) still open at `now` (no terminal outcome) are counted — this keeps the
 * donut aligned with the throughput/win-rate window while still showing the
 * current open backlog. Terminal items whose outcome landed before the window
 * are excluded so an old award doesn't distort the current period.
 */
export const outcomeBreakdown = (
  items: RfpPipelineItem[],
  startIso: string,
  endIso: string,
): OutcomeSlice[] => {
  const counts: Record<OutcomeKey, number> = {
    awarded: 0,
    lost: 0,
    noResponse: 0,
    pending: 0,
    notApproved: 0,
  };

  for (const item of items) {
    const stage = resolveStage(item);
    const submittedIso = submittedAtIso(item);
    const isTerminal =
      AWARDED_STAGES.includes(stage) ||
      LOST_STAGES.includes(stage) ||
      NOT_APPROVED_STAGES.includes(stage) ||
      item.status === 'WON' ||
      item.status === 'LOST' ||
      item.status === 'WITHDRAWN' ||
      item.status === 'NO_BID' ||
      stage === 'expired';

    // Window gate: closed items must have closed (submitted) in the window;
    // open items are always shown as the current backlog snapshot.
    if (isTerminal) {
      const closedIso = submittedIso ?? item.completedAt ?? item.updatedAt ?? null;
      if (!inWindow(closedIso, startIso, endIso)) continue;
    }

    if (item.status === 'WON' || AWARDED_STAGES.includes(stage)) counts.awarded += 1;
    else if (item.status === 'LOST' || LOST_STAGES.includes(stage)) counts.lost += 1;
    else if (NOT_APPROVED_STAGES.includes(stage)) counts.notApproved += 1;
    else if (item.status === 'WITHDRAWN' || item.status === 'NO_BID' || stage === 'expired')
      counts.noResponse += 1;
    else counts.pending += 1;
  }

  return (Object.keys(counts) as OutcomeKey[]).map((key) => ({
    key,
    label: OUTCOME_META[key].label,
    count: counts[key],
    color: OUTCOME_META[key].color,
  }));
};

// ─── 6. Aging — items stuck in one stage beyond a threshold ──────────────────

export interface AgingRow {
  item: RfpPipelineItem;
  stage: RfpPipelineStage;
  label: string;
  daysInStage: number;
}

/**
 * Items whose days-in-current-stage exceeds `thresholdDays`, sorted oldest
 * first. Snapshot at `nowIso` — NOT windowed. Terminal outcomes (submitted /
 * awarded / lost / notApproved / expired) are excluded: a closed RFP isn't
 * "stuck", it's done.
 */
export const aging = (
  items: RfpPipelineItem[],
  nowIso: string,
  thresholdDays = 7,
): AgingRow[] => {
  const rows: AgingRow[] = [];
  for (const item of items) {
    const stage = resolveStage(item);
    if (
      AWARDED_STAGES.includes(stage) ||
      LOST_STAGES.includes(stage) ||
      NOT_APPROVED_STAGES.includes(stage) ||
      stage === 'submitted' ||
      stage === 'expired'
    ) {
      continue;
    }
    const days = daysBetween(entryIntoCurrentStageIso(item), nowIso);
    if (days === null || days <= thresholdDays) continue;
    rows.push({ item, stage, label: RFP_STAGE_LABELS[stage], daysInStage: days });
  }
  return rows.sort((a, b) => b.daysInStage - a.daysInStage);
};

// ─── Owner options ───────────────────────────────────────────────────────────

export interface OwnerOption {
  assigneeId: string;
  assigneeName: string;
}

/** Distinct assignees across the items, sorted by name, for the owner filter. */
export const ownerOptions = (items: RfpPipelineItem[]): OwnerOption[] => {
  const byId = new Map<string, string>();
  for (const item of items) {
    if (!item.assigneeId) continue;
    if (!byId.has(item.assigneeId)) {
      byId.set(item.assigneeId, item.assigneeName ?? item.assigneeId);
    }
  }
  return [...byId.entries()]
    .map(([assigneeId, assigneeName]) => ({ assigneeId, assigneeName }))
    .sort((a, b) => a.assigneeName.localeCompare(b.assigneeName));
};

// ─── Date-range presets ──────────────────────────────────────────────────────

export interface MetricsDateRange {
  startIso: string;
  endIso: string;
}

/** A window ending at `nowIso` and starting `weeks` full weeks earlier. */
export const lastNWeeksRange = (nowIso: string, weeks: number): MetricsDateRange => {
  const end = new Date(nowIso);
  const start = new Date(end.getTime() - weeks * 7 * MS_PER_DAY);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
};

export const hasSubmittedInWindow = hasSubmitted;

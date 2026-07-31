import type {
  RfpPipelineItem,
  RfpPipelineStage,
  OpportunityApprovalStatus,
  OpportunityStatus,
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
 *   - outcome breakdown   : classify each item by its CURRENT resolved state,
 *     restricted to items active/closed within the window (submitted-in-window
 *     OR still-open snapshot). Documented in `outcomeBreakdown`.
 *   - aging               : a snapshot at `nowIso`, NOT windowed — it answers
 *     "what is stuck right now".
 *   - cycle time          : windowed by SUBMISSION date — an item contributes
 *     only if it was SUBMITTED within [startIso, endIso]. Within that cohort,
 *     each stage stat only counts items for which a valid entry→exit pair can be
 *     derived from the histories.
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

/** The terminal statuses that mark a closed outcome, and the stage they map to. */
const TERMINAL_STATUSES: readonly OpportunityStatus[] = ['WON', 'LOST', 'NO_BID', 'WITHDRAWN'];

/**
 * The ISO timestamp a terminal (closed) item actually reached its outcome, or
 * null if indeterminable. Prefer the real transition event — the submitted date,
 * then the latest statusHistory move into a terminal status, then `completedAt`.
 *
 * Deliberately does NOT fall back to `updatedAt`: the Linear sync rewrites
 * `updatedAt` on every poll, so anchoring on it made every terminal item (esp.
 * `notApproved`, which has no submit/complete date) look freshly-closed and thus
 * always inside the window. An item with no derivable close date is excluded
 * from the window instead of always counted.
 */
const terminalClosedIso = (item: RfpPipelineItem): string | null => {
  const submitted = submittedAtIso(item);
  if (submitted) return submitted;

  const sh = item.statusHistory ?? [];
  let latest: string | null = null;
  for (const t of sh) {
    if (!TERMINAL_STATUSES.includes(t.to)) continue;
    if (latest === null || Date.parse(t.changedAt) > Date.parse(latest)) latest = t.changedAt;
  }
  if (latest) return latest;

  return item.completedAt ?? null;
};

// ─── Filtering ───────────────────────────────────────────────────────────────

export interface MetricsFilter {
  startIso: string;
  endIso: string;
  /**
   * Optional owner filter, keyed on the assignee's NAME (the only assignee
   * identity present on Linear-synced items — there is no stable app user id).
   * undefined = all owners.
   */
  assigneeName?: string;
}

/**
 * Owner-only filter — restricts the working set by assignee name. Date-range
 * scoping is applied per metric (each metric decides what "in period" means), so
 * this intentionally does NOT drop items by date; it only narrows by owner.
 */
export const filterItems = (
  items: RfpPipelineItem[],
  { assigneeName }: Pick<MetricsFilter, 'assigneeName'>,
): RfpPipelineItem[] => {
  if (!assigneeName) return items;
  return items.filter((item) => item.assigneeName === assigneeName);
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

// ─── 2. Funnel — intake cohort followed through to submitted + conversion ────

export interface FunnelRow {
  stage: RfpPipelineStage;
  label: string;
  entered: number;
  /** Conversion % from the previous funnel row (null for the first row). */
  conversionFromPrev: number | null;
}

/**
 * Canonical funnel order — the lead-to-deal path from intake to a submitted bid:
 * intake → first approval → pre-submission → submitted. We deliberately use this
 * linear subset of the board (not the full 11-stage order, which includes
 * terminal dead-ends like notApproved/lost that would break a monotonic funnel),
 * and we stop at `submitted` rather than `awarded`: awards land months after
 * submission and are pruned from the board after RFP_TERMINAL_WINDOW_DAYS, so an
 * `awarded` row inside any reasonable cohort window would be structurally empty
 * and misleading. Win rate (awarded/submitted) is reported separately.
 */
export const FUNNEL_STAGE_ORDER: readonly RfpPipelineStage[] = [
  'execSummaryToReview',
  'firstApproved',
  'preSubmissionReview',
  'submitted',
];

/** Rank of an approval milestone along the lead-to-deal path (higher = further). */
const APPROVAL_RANK: Record<OpportunityApprovalStatus, number> = {
  INITIAL_APPROVAL: 0,
  I_APPROVED: 1,
  PRE_SUB_APPROVAL: 2,
  II_APPROVED: 2, // cleared to submit, still sits in the pre-submission funnel stage
  SUBMITTED: 3,
  NOT_APPROVED: 0, // terminal gate-1 rejection — off the funnel, never advanced it
};

/**
 * The furthest funnel stage index (0-based into FUNNEL_STAGE_ORDER) an item has
 * ever reached. Because the Linear sync stores only an item's CURRENT state
 * (not its full transition path), we infer the furthest point from the highest
 * approval milestone seen (current status + any approvalHistory `to`), plus the
 * submitted signal (awarded is also treated as submitted, since a WON item was
 * necessarily submitted first). Every item has at least reached intake (rank 0).
 */
const furthestFunnelRank = (item: RfpPipelineItem): number => {
  const seen: OpportunityApprovalStatus[] = [
    item.approvalStatus ?? 'INITIAL_APPROVAL',
    ...(item.approvalHistory ?? []).map((t) => t.to),
  ];
  const maxApprovalRank = seen.reduce((max, s) => Math.max(max, APPROVAL_RANK[s] ?? 0), 0);

  let rank = Math.min(maxApprovalRank, 2); // approval milestones cover ranks 0–2 of the funnel
  // Submitted (rank 3, the last row) — reached directly, via a rank-3 milestone,
  // or implied by an awarded outcome (WON ⇒ was submitted).
  if (hasSubmitted(item) || maxApprovalRank >= 3 || isAwarded(item)) rank = Math.max(rank, 3);
  return rank;
};

/**
 * The ISO timestamp an item entered intake (the top of the funnel), or null if
 * indeterminable. Prefer the first approvalHistory `to === 'INITIAL_APPROVAL'`
 * entry (the true intake event), then `createdAt` (the Linear sync always sets
 * this to the issue's creation date, so it's a sound intake proxy).
 *
 * We deliberately DON'T fall back to `entryIntoCurrentStageIso` here (unlike the
 * cycleTime `found` anchor): that returns entry into the item's *current* stage,
 * which for a late-stage item is dated ~now and would wrongly pull a
 * long-ago-sourced item into a recent cohort window. An item with no derivable
 * intake date is instead excluded from the cohort (null → outside every window).
 */
export const intakeEntryIso = (item: RfpPipelineItem): string | null =>
  firstReachedIso(item, 'INITIAL_APPROVAL') ?? item.createdAt ?? null;

/**
 * Cohort funnel over [startIso, endIso]: the cohort is every item whose INTAKE
 * entry falls inside the window; each row then counts how many of that same
 * fixed cohort ever reached that stage OR BEYOND. Because every row scores the
 * one cohort, counts are monotonically non-increasing and each conversion is the
 * share of the previous stage that advanced (always a clean 0–100%).
 *
 * This is a true cohort funnel, NOT a current-state snapshot: an item is placed
 * by WHEN it entered, and followed through regardless of where it sits now. The
 * dev data (median intake→submitted 13d, max 29d) confirms a window this size
 * captures a cohort's full journey without censoring the `submitted` row. The
 * `items` are already owner-filtered by the caller.
 */
export const funnel = (
  items: RfpPipelineItem[],
  startIso: string,
  endIso: string,
): FunnelRow[] => {
  const cohort = items.filter((item) => inWindow(intakeEntryIso(item), startIso, endIso));
  const ranks = cohort.map(furthestFunnelRank);
  const counts = FUNNEL_STAGE_ORDER.map(
    (_stage, i) => ranks.filter((r) => r >= i).length,
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

/**
 * The approval milestones, in order, whose consecutive gaps are stage durations.
 *
 * `II_APPROVED` is intentionally omitted: on the real board it is almost never
 * recorded as a distinct dated state (submissions overwhelmingly jump straight
 * from an earlier gate to SUBMITTED), so a `secondApproved` row was structurally
 * empty. Dropping it collapses the tail into a single `preSubmissionReview` row
 * measured directly as PRE_SUB_APPROVAL → SUBMITTED. The total found→submitted
 * span is unaffected (it is an independent end-to-end measurement, not a sum).
 */
const CYCLE_APPROVAL_ORDER: readonly OpportunityApprovalStatus[] = [
  'INITIAL_APPROVAL',
  'I_APPROVED',
  'PRE_SUB_APPROVAL',
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
 * duration — windowed by SUBMISSION date. Only items SUBMITTED within
 * [startIso, endIso] contribute; items not submitted, or submitted outside the
 * window, contribute nothing.
 *
 * Within that cohort, durations derive from the approvalHistory event log: the
 * days between reaching milestone N and milestone N+1. Items with sparse/empty
 * history simply don't contribute to a stage's sample (n reflects the count of
 * items that had a derivable entry→exit pair) — they are never guessed.
 */
export const cycleTime = (
  items: RfpPipelineItem[],
  startIso: string,
  endIso: string,
): CycleTimeSummary => {
  const perStageDurations = new Map<RfpPipelineStage, number[]>();
  const foundToSubmitted: number[] = [];

  for (const item of items) {
    // Window gate: only items submitted within [startIso, endIso] contribute.
    const submittedIso = submittedAtIso(item);
    if (!submittedIso || !inWindow(submittedIso, startIso, endIso)) continue;

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
    const total = daysBetween(firstIso, submittedIso);
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

// ─── 4. Outcome breakdown — donut buckets ────────────────────────────────────

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
 * In-period rule: an item counts only if it falls in the window on the anchor
 * appropriate to its state — (a) terminal items by their close/submit date, or
 * (b) still-open items by their INTAKE date (same cohort anchor as the funnel).
 * This keeps the entire donut, Pending included, responsive to the window
 * selector. Terminal items whose outcome landed before the window are excluded
 * so an old award doesn't distort the current period; open items sourced before
 * the window likewise drop out. Items with no derivable intake date are excluded.
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
    const isTerminal =
      AWARDED_STAGES.includes(stage) ||
      LOST_STAGES.includes(stage) ||
      NOT_APPROVED_STAGES.includes(stage) ||
      item.status === 'WON' ||
      item.status === 'LOST' ||
      item.status === 'WITHDRAWN' ||
      item.status === 'NO_BID' ||
      stage === 'expired';

    // Window gate: every item must fall in the window on a REAL date — terminal
    // items by the date they actually closed (never `updatedAt`, which the sync
    // bumps every poll and made notApproved perpetually in-window), open items by
    // their intake date (same cohort anchor as the funnel). Items with no
    // derivable anchor drop out rather than always counting.
    if (isTerminal) {
      if (!inWindow(terminalClosedIso(item), startIso, endIso)) continue;
    } else if (!inWindow(intakeEntryIso(item), startIso, endIso)) {
      continue;
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
  assigneeName: string;
}

/**
 * Distinct assignees across the items, keyed by NAME (the identity that exists
 * on Linear-synced records — no stable assigneeId is available), sorted
 * alphabetically, for the owner filter. Items with a null/undefined/empty name
 * are skipped.
 */
export const ownerOptions = (items: RfpPipelineItem[]): OwnerOption[] => {
  const names = new Set<string>();
  for (const item of items) {
    const name = item.assigneeName?.trim();
    if (!name) continue;
    names.add(name);
  }
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((assigneeName) => ({ assigneeName }));
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

/**
 * Fixed cohort window for the funnel: 60 days. Chosen against real data — the
 * dev board's intake→submitted cycle maxes out at 29 days, so 60 days captures
 * every cohort member's full journey (no `submitted`-row censoring) while being
 * wide enough to keep cohort sizes meaningful. A window ending at `nowIso`.
 */
export const FUNNEL_COHORT_DAYS = 60;

/** The funnel's fixed 60-day cohort window ending at `nowIso`. */
export const funnelCohortRange = (nowIso: string): MetricsDateRange => {
  const end = new Date(nowIso);
  const start = new Date(end.getTime() - FUNNEL_COHORT_DAYS * MS_PER_DAY);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
};

/**
 * Fixed window for cycle time: 60 days, matching the funnel cohort. Cycle time
 * answers "how fast are the RFPs we submitted recently moving", so it is pinned
 * to a fixed recent period rather than riding the tab's week-range selector.
 */
export const CYCLE_TIME_WINDOW_DAYS = 60;

/** Cycle time's fixed 60-day window (by submission date) ending at `nowIso`. */
export const cycleTimeRange = (nowIso: string): MetricsDateRange => {
  const end = new Date(nowIso);
  const start = new Date(end.getTime() - CYCLE_TIME_WINDOW_DAYS * MS_PER_DAY);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
};

export const hasSubmittedInWindow = hasSubmitted;

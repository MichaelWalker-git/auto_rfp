import {
  daysBetween,
  median,
  average,
  weekStart,
  weekLabel,
  submittedAtIso,
  filterItems,
  throughputByWeek,
  funnel,
  cycleTime,
  winRate,
  outcomeBreakdown,
  aging,
  ownerOptions,
  lastNWeeksRange,
  funnelCohortRange,
  FUNNEL_STAGE_ORDER,
} from '../derive-metrics';
import { makeItem, approvalTransition } from '../../__tests__/fixtures';

// A fixed "now" — a Monday, so week math is predictable.
const NOW = '2026-07-27T12:00:00.000Z'; // 2026-07-27 is a Monday

describe('primitive helpers', () => {
  it('daysBetween returns whole days and null for bad input', () => {
    expect(daysBetween('2026-07-01T00:00:00Z', '2026-07-08T00:00:00Z')).toBe(7);
    expect(daysBetween(null, '2026-07-08T00:00:00Z')).toBeNull();
    expect(daysBetween('not-a-date', '2026-07-08T00:00:00Z')).toBeNull();
    expect(daysBetween(undefined, undefined)).toBeNull();
  });

  it('median handles odd, even, and empty lists', () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('average handles empty and non-empty lists', () => {
    expect(average([])).toBeNull();
    expect(average([2, 4, 6])).toBe(4);
  });

  it('weekStart snaps to the Monday of the containing week', () => {
    // Wednesday 2026-07-29 → Monday 2026-07-27
    expect(weekStart('2026-07-29T10:00:00Z').toISOString()).toBe('2026-07-27T00:00:00.000Z');
    // Sunday 2026-07-26 → Monday 2026-07-20 (Sunday is the LAST day of its ISO week)
    expect(weekStart('2026-07-26T23:00:00Z').toISOString()).toBe('2026-07-20T00:00:00.000Z');
    // Monday itself → same day
    expect(weekStart('2026-07-27T00:00:00Z').toISOString()).toBe('2026-07-27T00:00:00.000Z');
  });

  it('weekLabel formats a compact month/day', () => {
    expect(weekLabel(new Date('2026-07-20T00:00:00Z'))).toBe('Jul 20');
  });
});

describe('lastNWeeksRange', () => {
  it('spans N weeks ending at now', () => {
    const { startIso, endIso } = lastNWeeksRange(NOW, 8);
    expect(endIso).toBe(NOW);
    expect(daysBetween(startIso, endIso)).toBe(56);
  });
});

describe('submittedAtIso', () => {
  it('prefers the approvalHistory SUBMITTED entry', () => {
    const item = makeItem({
      approvalHistory: [approvalTransition('SUBMITTED', '2026-07-10T00:00:00.000Z')],
      statusHistory: [],
    });
    expect(submittedAtIso(item)).toBe('2026-07-10T00:00:00.000Z');
  });

  it('falls back to statusHistory SUBMITTED', () => {
    const item = makeItem({
      approvalHistory: [],
      statusHistory: [
        { from: null, to: 'SUBMITTED', changedAt: '2026-07-11T00:00:00.000Z', changedBy: 'u', source: 'MANUAL' },
      ],
    });
    expect(submittedAtIso(item)).toBe('2026-07-11T00:00:00.000Z');
  });

  it('falls back to completedAt only when the board stage is submitted', () => {
    const submitted = makeItem({ pipelineStage: 'submitted', completedAt: '2026-07-12T00:00:00.000Z' });
    expect(submittedAtIso(submitted)).toBe('2026-07-12T00:00:00.000Z');
    const notSubmitted = makeItem({ pipelineStage: 'inProgress', completedAt: '2026-07-12T00:00:00.000Z' });
    expect(submittedAtIso(notSubmitted)).toBeNull();
  });

  it('returns null when nothing indicates submission', () => {
    expect(submittedAtIso(makeItem())).toBeNull();
  });
});

describe('filterItems (owner filter)', () => {
  const items = [
    makeItem({ id: 'a', assigneeName: 'Amy' }),
    makeItem({ id: 'b', assigneeName: 'Bob' }),
    makeItem({ id: 'c', assigneeName: 'Amy' }),
  ];

  it('returns all items when no owner is given', () => {
    expect(filterItems(items, {})).toHaveLength(3);
  });

  it('narrows to the selected owner by name', () => {
    expect(filterItems(items, { assigneeName: 'Amy' }).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('filters Linear-synced items that have ONLY a name (no assigneeId)', () => {
    // Regression: Linear sync populates assigneeName but never assigneeId, so the
    // owner filter must key on name. Items with assigneeId undefined must still
    // be filterable by their name.
    const linearSynced = [
      makeItem({ id: 'l1', assigneeId: undefined, assigneeName: 'Grace Hopper' }),
      makeItem({ id: 'l2', assigneeId: undefined, assigneeName: 'Alan Turing' }),
      makeItem({ id: 'l3', assigneeId: undefined, assigneeName: 'Grace Hopper' }),
    ];
    expect(
      filterItems(linearSynced, { assigneeName: 'Grace Hopper' }).map((i) => i.id),
    ).toEqual(['l1', 'l3']);
  });
});

describe('throughputByWeek', () => {
  const { startIso, endIso } = lastNWeeksRange(NOW, 8);

  it('returns empty-safe dense buckets for no submissions', () => {
    const buckets = throughputByWeek([makeItem()], startIso, endIso);
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });

  it('buckets submissions into the correct ISO week', () => {
    const items = [
      makeItem({ id: 'a', approvalHistory: [approvalTransition('SUBMITTED', '2026-07-22T00:00:00.000Z')] }),
      makeItem({ id: 'b', approvalHistory: [approvalTransition('SUBMITTED', '2026-07-23T00:00:00.000Z')] }),
      makeItem({ id: 'c', approvalHistory: [approvalTransition('SUBMITTED', '2026-07-15T00:00:00.000Z')] }),
    ];
    const buckets = throughputByWeek(items, startIso, endIso);
    // 22nd and 23rd are the same ISO week (Mon 2026-07-20).
    const wk20 = buckets.find((b) => b.weekStartIso === '2026-07-20T00:00:00.000Z');
    const wk13 = buckets.find((b) => b.weekStartIso === '2026-07-13T00:00:00.000Z');
    expect(wk20?.count).toBe(2);
    expect(wk13?.count).toBe(1);
  });

  it('excludes submissions outside the window', () => {
    const items = [
      makeItem({ id: 'old', approvalHistory: [approvalTransition('SUBMITTED', '2026-01-01T00:00:00.000Z')] }),
    ];
    const total = throughputByWeek(items, startIso, endIso).reduce((s, b) => s + b.count, 0);
    expect(total).toBe(0);
  });
});

describe('funnel', () => {
  // A 60-day window ending at NOW; intake events at `AT` (a week before) fall inside.
  const { startIso: FUNNEL_START, endIso: FUNNEL_END } = funnelCohortRange(NOW);
  const AT = '2026-07-20T00:00:00.000Z'; // inside the window

  it('follows the canonical intake→submitted stage order (no awarded row)', () => {
    const rows = funnel([], FUNNEL_START, FUNNEL_END);
    expect(rows.map((r) => r.stage)).toEqual([...FUNNEL_STAGE_ORDER]);
    expect(rows.map((r) => r.stage)).not.toContain('awarded');
    expect(rows.every((r) => r.entered === 0)).toBe(true);
    expect(rows[0]!.conversionFromPrev).toBeNull();
  });

  it('counts each cohort item cumulatively at its furthest stage + conversion between stages', () => {
    const items = [
      // Furthest = submitted (rank 3).
      makeItem({
        id: 'a',
        approvalStatus: 'SUBMITTED',
        approvalHistory: [
          approvalTransition('INITIAL_APPROVAL', AT),
          approvalTransition('I_APPROVED', AT),
          approvalTransition('SUBMITTED', AT),
        ],
      }),
      // Furthest = first approval (rank 1).
      makeItem({
        id: 'b',
        approvalStatus: 'I_APPROVED',
        approvalHistory: [
          approvalTransition('INITIAL_APPROVAL', AT),
          approvalTransition('I_APPROVED', AT),
        ],
      }),
      // Furthest = initial (rank 0).
      makeItem({
        id: 'c',
        approvalStatus: 'INITIAL_APPROVAL',
        approvalHistory: [approvalTransition('INITIAL_APPROVAL', AT)],
      }),
    ];
    const rows = funnel(items, FUNNEL_START, FUNNEL_END);
    const byStage = Object.fromEntries(rows.map((r) => [r.stage, r]));
    // Cumulative: reached this stage OR beyond → monotonically non-increasing.
    expect(byStage.execSummaryToReview!.entered).toBe(3);
    expect(byStage.firstApproved!.entered).toBe(2);
    expect(byStage.preSubmissionReview!.entered).toBe(1);
    expect(byStage.submitted!.entered).toBe(1);
    // 2 of 3 reached first approval → 66.7%
    expect(byStage.firstApproved!.conversionFromPrev).toBeCloseTo(66.67, 1);
    // 1 of 2 advanced to pre-submission → 50%
    expect(byStage.preSubmissionReview!.conversionFromPrev).toBe(50);
    // 1 of 1 advanced to submitted → 100% (never exceeds 100)
    expect(byStage.submitted!.conversionFromPrev).toBe(100);
  });

  it('excludes items whose intake entry falls outside the cohort window', () => {
    const items = [
      // Intake 6 months ago → outside the 60-day window → excluded entirely.
      makeItem({
        id: 'old',
        approvalStatus: 'I_APPROVED',
        approvalHistory: [
          approvalTransition('INITIAL_APPROVAL', '2026-01-15T00:00:00.000Z'),
          approvalTransition('I_APPROVED', '2026-01-20T00:00:00.000Z'),
        ],
      }),
      // Intake inside the window → counted.
      makeItem({
        id: 'recent',
        approvalStatus: 'I_APPROVED',
        approvalHistory: [
          approvalTransition('INITIAL_APPROVAL', AT),
          approvalTransition('I_APPROVED', AT),
        ],
      }),
    ];
    const rows = funnel(items, FUNNEL_START, FUNNEL_END);
    const byStage = Object.fromEntries(rows.map((r) => [r.stage, r]));
    expect(byStage.execSummaryToReview!.entered).toBe(1);
    expect(byStage.firstApproved!.entered).toBe(1);
  });

  it('falls back to createdAt for the intake anchor when approvalHistory has no INITIAL_APPROVAL', () => {
    const items = [
      makeItem({ id: 'a', createdAt: AT, approvalStatus: 'INITIAL_APPROVAL', approvalHistory: [] }),
    ];
    const rows = funnel(items, FUNNEL_START, FUNNEL_END);
    expect(rows.find((r) => r.stage === 'execSummaryToReview')!.entered).toBe(1);
  });

  it('excludes an item with no derivable intake date rather than mis-dating it into the cohort', () => {
    // No INITIAL_APPROVAL milestone and no createdAt: the intake anchor is
    // indeterminable, so the item must be dropped from the cohort — NOT dated to
    // its current (late) stage and pulled in. A SUBMITTED-only history at NOW
    // would otherwise sneak a long-ago-sourced item into a recent window.
    const items = [
      makeItem({
        id: 'no-intake',
        createdAt: undefined,
        approvalStatus: 'SUBMITTED',
        approvalHistory: [approvalTransition('SUBMITTED', NOW)],
      }),
    ];
    const rows = funnel(items, FUNNEL_START, FUNNEL_END);
    expect(rows.every((r) => r.entered === 0)).toBe(true);
  });

  it('excludes an out-of-window item that is already terminal', () => {
    const items = [
      makeItem({
        id: 'old-submitted',
        createdAt: '2026-01-01T00:00:00.000Z',
        approvalStatus: 'SUBMITTED',
        approvalHistory: [
          approvalTransition('INITIAL_APPROVAL', '2026-01-01T00:00:00.000Z'),
          approvalTransition('SUBMITTED', '2026-01-20T00:00:00.000Z'),
        ],
      }),
    ];
    const rows = funnel(items, FUNNEL_START, FUNNEL_END);
    expect(rows.every((r) => r.entered === 0)).toBe(true);
  });

  it('never produces a conversion above 100% even when later stages look fuller', () => {
    // A pathological input: many items at first-approved, few showing only intake.
    const items = [
      ...Array.from({ length: 20 }, (_v, i) =>
        makeItem({
          id: `fa-${i}`,
          approvalStatus: 'I_APPROVED',
          approvalHistory: [
            approvalTransition('INITIAL_APPROVAL', AT),
            approvalTransition('I_APPROVED', AT),
          ],
        }),
      ),
      makeItem({
        id: 'init-1',
        approvalStatus: 'INITIAL_APPROVAL',
        approvalHistory: [approvalTransition('INITIAL_APPROVAL', AT)],
      }),
      makeItem({
        id: 'init-2',
        approvalStatus: 'INITIAL_APPROVAL',
        approvalHistory: [approvalTransition('INITIAL_APPROVAL', AT)],
      }),
    ];
    const rows = funnel(items, FUNNEL_START, FUNNEL_END);
    const byStage = Object.fromEntries(rows.map((r) => [r.stage, r]));
    // All 22 reached intake; 20 reached first approval → 90.9%, not 1000%.
    expect(byStage.execSummaryToReview!.entered).toBe(22);
    expect(byStage.firstApproved!.entered).toBe(20);
    expect(byStage.firstApproved!.conversionFromPrev).toBeCloseTo(90.9, 1);
    rows.forEach((r) => {
      if (r.conversionFromPrev !== null) expect(r.conversionFromPrev).toBeLessThanOrEqual(100);
    });
  });

  it('counts an awarded cohort item as submitted (WON ⇒ was submitted)', () => {
    const items = [
      makeItem({
        id: 'a',
        status: 'WON',
        pipelineStage: 'awarded',
        completedAt: NOW,
        approvalHistory: [approvalTransition('INITIAL_APPROVAL', AT)],
      }),
    ];
    const rows = funnel(items, FUNNEL_START, FUNNEL_END);
    // Reaches the terminal `submitted` row and every earlier stage.
    expect(rows.find((r) => r.stage === 'submitted')!.entered).toBe(1);
    expect(rows.find((r) => r.stage === 'execSummaryToReview')!.entered).toBe(1);
  });
});

describe('cycleTime', () => {
  // A wide window that comfortably includes every July-2026 fixture submission.
  const WINDOW_START = '2026-06-01T00:00:00.000Z';
  const WINDOW_END = '2026-08-01T00:00:00.000Z';

  it('computes avg and median per stage from consecutive milestones', () => {
    const items = [
      makeItem({
        id: 'a',
        approvalHistory: [
          approvalTransition('INITIAL_APPROVAL', '2026-07-01T00:00:00.000Z'),
          approvalTransition('I_APPROVED', '2026-07-05T00:00:00.000Z'), // 4d in execSummaryToReview
          approvalTransition('SUBMITTED', '2026-07-10T00:00:00.000Z'), // submitted-in-window
        ],
        createdAt: '2026-07-01T00:00:00.000Z',
      }),
      makeItem({
        id: 'b',
        approvalHistory: [
          approvalTransition('INITIAL_APPROVAL', '2026-07-01T00:00:00.000Z'),
          approvalTransition('I_APPROVED', '2026-07-03T00:00:00.000Z'), // 2d in execSummaryToReview
          approvalTransition('SUBMITTED', '2026-07-03T00:00:00.000Z'), // submitted-in-window (2d found→submitted)
        ],
      }),
    ];
    const { perStage, foundToSubmitted } = cycleTime(items, WINDOW_START, WINDOW_END);
    const initial = perStage.find((r) => r.stage === 'execSummaryToReview')!;
    expect(initial.n).toBe(2);
    expect(initial.avgDays).toBe(3); // (4 + 2) / 2
    expect(initial.medianDays).toBe(3);
    // found-to-submitted: item a (9d) + item b (2d)
    expect(foundToSubmitted.n).toBe(2);
    expect(foundToSubmitted.avgDays).toBe(5.5); // (9 + 2) / 2
  });

  it('does not throw on empty/sparse history and reports n=0', () => {
    const { perStage, foundToSubmitted } = cycleTime(
      [makeItem(), makeItem({ approvalHistory: undefined })],
      WINDOW_START,
      WINDOW_END,
    );
    expect(perStage.every((r) => r.n === 0 && r.avgDays === null && r.medianDays === null)).toBe(true);
    expect(foundToSubmitted.n).toBe(0);
    expect(foundToSubmitted.avgDays).toBeNull();
  });

  it('excludes an item SUBMITTED before the window from both perStage and foundToSubmitted', () => {
    const items = [
      // Submitted 2026-01-10 — well before the window → excluded entirely.
      makeItem({
        id: 'pre-window',
        approvalHistory: [
          approvalTransition('INITIAL_APPROVAL', '2026-01-01T00:00:00.000Z'),
          approvalTransition('I_APPROVED', '2026-01-05T00:00:00.000Z'),
          approvalTransition('SUBMITTED', '2026-01-10T00:00:00.000Z'),
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const { perStage, foundToSubmitted } = cycleTime(items, WINDOW_START, WINDOW_END);
    expect(perStage.every((r) => r.n === 0)).toBe(true);
    expect(foundToSubmitted.n).toBe(0);
  });

  it('excludes an item that was never submitted', () => {
    const items = [
      makeItem({
        id: 'never-submitted',
        approvalHistory: [
          approvalTransition('INITIAL_APPROVAL', '2026-07-01T00:00:00.000Z'),
          approvalTransition('I_APPROVED', '2026-07-05T00:00:00.000Z'),
        ],
        createdAt: '2026-07-01T00:00:00.000Z',
      }),
    ];
    const { perStage, foundToSubmitted } = cycleTime(items, WINDOW_START, WINDOW_END);
    expect(perStage.every((r) => r.n === 0)).toBe(true);
    expect(foundToSubmitted.n).toBe(0);
  });

  it('includes an item SUBMITTED within the window', () => {
    const items = [
      makeItem({
        id: 'in-window',
        approvalHistory: [
          approvalTransition('INITIAL_APPROVAL', '2026-07-01T00:00:00.000Z'),
          approvalTransition('I_APPROVED', '2026-07-05T00:00:00.000Z'), // 4d
          approvalTransition('SUBMITTED', '2026-07-10T00:00:00.000Z'), // 9d found→submitted
        ],
        createdAt: '2026-07-01T00:00:00.000Z',
      }),
    ];
    const { perStage, foundToSubmitted } = cycleTime(items, WINDOW_START, WINDOW_END);
    const initial = perStage.find((r) => r.stage === 'execSummaryToReview')!;
    expect(initial.n).toBe(1);
    expect(initial.avgDays).toBe(4);
    expect(foundToSubmitted.n).toBe(1);
    expect(foundToSubmitted.avgDays).toBe(9);
  });
});

describe('winRate', () => {
  const { startIso, endIso } = lastNWeeksRange(NOW, 8);

  it('is null when nothing was submitted in the window', () => {
    expect(winRate([makeItem()], startIso, endIso)).toEqual({ awarded: 0, submitted: 0, rate: null });
  });

  it('computes awarded / submitted with raw counts', () => {
    const items = [
      makeItem({
        id: 'won',
        status: 'WON',
        pipelineStage: 'awarded',
        approvalHistory: [approvalTransition('SUBMITTED', '2026-07-20T00:00:00.000Z')],
      }),
      makeItem({
        id: 'sub1',
        approvalHistory: [approvalTransition('SUBMITTED', '2026-07-21T00:00:00.000Z')],
      }),
      makeItem({
        id: 'sub2',
        approvalHistory: [approvalTransition('SUBMITTED', '2026-07-22T00:00:00.000Z')],
      }),
    ];
    expect(winRate(items, startIso, endIso)).toEqual({
      awarded: 1,
      submitted: 3,
      rate: (1 / 3) * 100,
    });
  });
});

describe('outcomeBreakdown', () => {
  const { startIso, endIso } = lastNWeeksRange(NOW, 8);

  it('classifies current state into the five buckets', () => {
    const items = [
      makeItem({ id: 'won', status: 'WON', pipelineStage: 'awarded', completedAt: '2026-07-20T00:00:00.000Z' }),
      makeItem({ id: 'lost', status: 'LOST', pipelineStage: 'lost', completedAt: '2026-07-20T00:00:00.000Z' }),
      makeItem({ id: 'na', pipelineStage: 'notApproved', completedAt: '2026-07-20T00:00:00.000Z' }),
      makeItem({ id: 'wd', status: 'WITHDRAWN', pipelineStage: 'expired', completedAt: '2026-07-20T00:00:00.000Z' }),
      makeItem({ id: 'open', pipelineStage: 'inProgress' }),
    ];
    const slices = outcomeBreakdown(items, startIso, endIso);
    const byKey = Object.fromEntries(slices.map((s) => [s.key, s.count]));
    expect(byKey.awarded).toBe(1);
    expect(byKey.lost).toBe(1);
    expect(byKey.notApproved).toBe(1);
    expect(byKey.noResponse).toBe(1);
    expect(byKey.pending).toBe(1);
  });

  it('always returns all five buckets even when empty', () => {
    const slices = outcomeBreakdown([], startIso, endIso);
    expect(slices.map((s) => s.key).sort()).toEqual(
      ['awarded', 'lost', 'noResponse', 'notApproved', 'pending'].sort(),
    );
    expect(slices.every((s) => s.count === 0)).toBe(true);
  });

  it('excludes terminal items that closed before the window; keeps open backlog', () => {
    const items = [
      makeItem({ id: 'oldWin', status: 'WON', pipelineStage: 'awarded', completedAt: '2026-01-01T00:00:00.000Z' }),
      makeItem({ id: 'open', pipelineStage: 'inProgress' }),
    ];
    const byKey = Object.fromEntries(outcomeBreakdown(items, startIso, endIso).map((s) => [s.key, s.count]));
    expect(byKey.awarded).toBe(0);
    expect(byKey.pending).toBe(1);
  });
});

describe('aging', () => {
  it('lists open items past the threshold, sorted oldest first', () => {
    const items = [
      makeItem({
        id: 'stale',
        pipelineStage: 'inProgress',
        approvalHistory: [approvalTransition('I_APPROVED', '2026-07-01T00:00:00.000Z')],
        approvalStatus: 'I_APPROVED',
      }),
      makeItem({
        id: 'fresh',
        pipelineStage: 'inProgress',
        approvalHistory: [approvalTransition('I_APPROVED', '2026-07-25T00:00:00.000Z')],
        approvalStatus: 'I_APPROVED',
      }),
    ];
    const rows = aging(items, NOW, 7);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.item.id).toBe('stale');
    expect(rows[0]!.daysInStage).toBeGreaterThan(7);
  });

  it('respects a custom threshold', () => {
    const items = [
      makeItem({
        id: 'x',
        pipelineStage: 'inProgress',
        approvalHistory: [approvalTransition('I_APPROVED', '2026-07-24T00:00:00.000Z')],
        approvalStatus: 'I_APPROVED',
      }),
    ];
    expect(aging(items, NOW, 7)).toHaveLength(0); // ~3 days
    expect(aging(items, NOW, 2)).toHaveLength(1);
  });

  it('excludes terminal stages and does not throw on missing history', () => {
    const items = [
      makeItem({ id: 'submitted', pipelineStage: 'submitted' }),
      makeItem({ id: 'awarded', pipelineStage: 'awarded' }),
      makeItem({ id: 'noHistory', pipelineStage: 'inProgress', approvalHistory: undefined, statusHistory: undefined, updatedAt: undefined, createdAt: undefined }),
    ];
    expect(() => aging(items, NOW, 7)).not.toThrow();
    expect(aging(items, NOW, 7)).toHaveLength(0);
  });
});

describe('ownerOptions', () => {
  it('returns distinct owners keyed by name, sorted alphabetically', () => {
    const items = [
      makeItem({ id: 'a', assigneeName: 'Zed' }),
      makeItem({ id: 'b', assigneeName: 'Amy' }),
      makeItem({ id: 'c', assigneeName: 'Amy' }),
      makeItem({ id: 'd', assigneeName: undefined }),
    ];
    expect(ownerOptions(items)).toEqual([{ assigneeName: 'Amy' }, { assigneeName: 'Zed' }]);
  });

  it('builds owner options from Linear-synced items that have ONLY a name (no assigneeId)', () => {
    // Regression: the entire board is Linear-synced, where assigneeId is always
    // undefined and only assigneeName is set. The dropdown must still populate.
    const linearSynced = [
      makeItem({ id: 'l1', assigneeId: undefined, assigneeName: 'Grace Hopper' }),
      makeItem({ id: 'l2', assigneeId: undefined, assigneeName: 'Alan Turing' }),
      makeItem({ id: 'l3', assigneeId: undefined, assigneeName: 'Grace Hopper' }),
    ];
    expect(ownerOptions(linearSynced)).toEqual([
      { assigneeName: 'Alan Turing' },
      { assigneeName: 'Grace Hopper' },
    ]);
  });

  it('skips null/undefined/empty-string names', () => {
    const items = [
      makeItem({ id: 'a', assigneeName: undefined }),
      makeItem({ id: 'b', assigneeName: '   ' }),
      makeItem({ id: 'c', assigneeName: 'Ada' }),
    ];
    expect(ownerOptions(items)).toEqual([{ assigneeName: 'Ada' }]);
  });

  it('handles empty input', () => {
    expect(ownerOptions([])).toEqual([]);
  });
});

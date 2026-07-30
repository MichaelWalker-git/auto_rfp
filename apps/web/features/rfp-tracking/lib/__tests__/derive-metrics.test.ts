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
  const { startIso, endIso } = lastNWeeksRange(NOW, 8);

  it('follows the canonical lead-to-deal stage order', () => {
    const rows = funnel([], startIso, endIso);
    expect(rows.map((r) => r.stage)).toEqual([...FUNNEL_STAGE_ORDER]);
    expect(rows.every((r) => r.entered === 0)).toBe(true);
    expect(rows[0]!.conversionFromPrev).toBeNull();
  });

  it('counts entries per stage and computes conversion between stages', () => {
    const inWin = '2026-07-20T00:00:00.000Z';
    const items = [
      // Reaches initial + first approval + submitted.
      makeItem({
        id: 'a',
        approvalHistory: [
          approvalTransition('INITIAL_APPROVAL', inWin),
          approvalTransition('I_APPROVED', inWin),
          approvalTransition('SUBMITTED', inWin),
        ],
      }),
      // Reaches only initial + first approval.
      makeItem({
        id: 'b',
        approvalHistory: [
          approvalTransition('INITIAL_APPROVAL', inWin),
          approvalTransition('I_APPROVED', inWin),
        ],
      }),
      // Reaches only initial.
      makeItem({ id: 'c', approvalHistory: [approvalTransition('INITIAL_APPROVAL', inWin)] }),
    ];
    const rows = funnel(items, startIso, endIso);
    const byStage = Object.fromEntries(rows.map((r) => [r.stage, r]));
    expect(byStage.execSummaryToReview!.entered).toBe(3);
    expect(byStage.firstApproved!.entered).toBe(2);
    expect(byStage.submitted!.entered).toBe(1);
    // 2 of 3 → 66.7%
    expect(byStage.firstApproved!.conversionFromPrev).toBeCloseTo(66.67, 1);
    // preSubmissionReview had 0 entries → submitted conversion from 0 = 0
    expect(byStage.submitted!.conversionFromPrev).toBe(0);
  });

  it('counts awarded via current stage + completedAt in window', () => {
    const items = [
      makeItem({ id: 'a', status: 'WON', pipelineStage: 'awarded', completedAt: '2026-07-20T00:00:00.000Z' }),
    ];
    const rows = funnel(items, startIso, endIso);
    expect(rows.find((r) => r.stage === 'awarded')!.entered).toBe(1);
  });
});

describe('cycleTime', () => {
  it('computes avg and median per stage from consecutive milestones', () => {
    const items = [
      makeItem({
        id: 'a',
        approvalHistory: [
          approvalTransition('INITIAL_APPROVAL', '2026-07-01T00:00:00.000Z'),
          approvalTransition('I_APPROVED', '2026-07-05T00:00:00.000Z'), // 4d in execSummaryToReview
          approvalTransition('SUBMITTED', '2026-07-10T00:00:00.000Z'),
        ],
        createdAt: '2026-07-01T00:00:00.000Z',
      }),
      makeItem({
        id: 'b',
        approvalHistory: [
          approvalTransition('INITIAL_APPROVAL', '2026-07-01T00:00:00.000Z'),
          approvalTransition('I_APPROVED', '2026-07-03T00:00:00.000Z'), // 2d in execSummaryToReview
        ],
      }),
    ];
    const { perStage, foundToSubmitted } = cycleTime(items);
    const initial = perStage.find((r) => r.stage === 'execSummaryToReview')!;
    expect(initial.n).toBe(2);
    expect(initial.avgDays).toBe(3); // (4 + 2) / 2
    expect(initial.medianDays).toBe(3);
    // found-to-submitted only has item a (9 days from initial → submitted)
    expect(foundToSubmitted.n).toBe(1);
    expect(foundToSubmitted.avgDays).toBe(9);
  });

  it('does not throw on empty/sparse history and reports n=0', () => {
    const { perStage, foundToSubmitted } = cycleTime([makeItem(), makeItem({ approvalHistory: undefined })]);
    expect(perStage.every((r) => r.n === 0 && r.avgDays === null && r.medianDays === null)).toBe(true);
    expect(foundToSubmitted.n).toBe(0);
    expect(foundToSubmitted.avgDays).toBeNull();
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

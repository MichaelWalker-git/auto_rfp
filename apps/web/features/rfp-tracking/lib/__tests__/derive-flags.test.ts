import { deriveFlags, groupFlagsByType } from '../derive-flags';
import { makeItem, transition, approvalTransition } from '../../__tests__/fixtures';

describe('deriveFlags — SUBMITTED_WITHOUT_APPROVAL', () => {
  it('flags a SUBMITTED item whose approval never reached II_APPROVED', () => {
    const item = makeItem({
      approvalStatus: 'SUBMITTED',
      approvalHistory: [approvalTransition('SUBMITTED', '2026-07-01T00:00:00.000Z', 'INITIAL_APPROVAL', 'STAGE')],
    });
    const flags = deriveFlags([item]);
    expect(flags.map((f) => f.type)).toContain('SUBMITTED_WITHOUT_APPROVAL');
  });

  it('flags a SUBMITTED item that cleared gate 2 but skipped gate 1', () => {
    const item = makeItem({
      approvalStatus: 'SUBMITTED',
      status: 'PURSUING',
      responseDeadlineIso: '2026-08-01T00:00:00.000Z',
      approvalHistory: [
        approvalTransition('II_APPROVED', '2026-06-20T00:00:00.000Z', 'PRE_SUB_APPROVAL', 'FINAL'),
        approvalTransition('SUBMITTED', '2026-07-01T00:00:00.000Z', 'II_APPROVED', 'STAGE'),
      ],
    });
    const flags = deriveFlags([item]);
    expect(flags.map((f) => f.type)).toContain('SUBMITTED_WITHOUT_APPROVAL');
    expect(flags.find((f) => f.type === 'SUBMITTED_WITHOUT_APPROVAL')!.message).toMatch(/initial approval/i);
  });

  it('reports both gates when a SUBMITTED item cleared neither', () => {
    const item = makeItem({
      approvalStatus: 'SUBMITTED',
      status: 'PURSUING',
      responseDeadlineIso: '2026-08-01T00:00:00.000Z',
      approvalHistory: [approvalTransition('SUBMITTED', '2026-07-01T00:00:00.000Z', 'INITIAL_APPROVAL', 'STAGE')],
    });
    const flag = deriveFlags([item]).find((f) => f.type === 'SUBMITTED_WITHOUT_APPROVAL')!;
    expect(flag.message).toMatch(/either approval gate/i);
  });

  it('does NOT flag a SUBMITTED item that cleared final approval', () => {
    const item = makeItem({
      approvalStatus: 'SUBMITTED',
      status: 'PURSUING',
      responseDeadlineIso: '2026-08-01T00:00:00.000Z',
      approvalHistory: [
        approvalTransition('I_APPROVED', '2026-06-01T00:00:00.000Z', 'INITIAL_APPROVAL', 'INITIAL'),
        approvalTransition('PRE_SUB_APPROVAL', '2026-06-10T00:00:00.000Z', 'I_APPROVED', 'STAGE'),
        approvalTransition('II_APPROVED', '2026-06-20T00:00:00.000Z', 'PRE_SUB_APPROVAL', 'FINAL'),
        approvalTransition('SUBMITTED', '2026-07-01T00:00:00.000Z', 'II_APPROVED', 'STAGE'),
      ],
    });
    expect(deriveFlags([item]).map((f) => f.type)).not.toContain('SUBMITTED_WITHOUT_APPROVAL');
  });
});

describe('deriveFlags — missing owner / deadline (active only)', () => {
  it('flags an active item with no assignee', () => {
    const item = makeItem({
      status: 'PURSUING',
      assigneeId: undefined,
      responseDeadlineIso: '2026-08-01T00:00:00.000Z',
    });
    expect(deriveFlags([item]).map((f) => f.type)).toContain('MISSING_OWNER');
  });

  it('flags an active item with no deadline', () => {
    const item = makeItem({ status: 'PURSUING', responseDeadlineIso: undefined });
    expect(deriveFlags([item]).map((f) => f.type)).toContain('MISSING_DEADLINE');
  });

  it('does NOT flag a terminal item for a missing owner or deadline', () => {
    const item = makeItem({
      status: 'WON',
      assigneeId: undefined,
      responseDeadlineIso: undefined,
      winData: { awardAmount: 1 } as never,
    });
    const types = deriveFlags([item]).map((f) => f.type);
    expect(types).not.toContain('MISSING_OWNER');
    expect(types).not.toContain('MISSING_DEADLINE');
  });
});

describe('deriveFlags — TERMINAL_MISSING_OUTCOME', () => {
  it('flags a WON item without winData', () => {
    const item = makeItem({
      status: 'WON',
      statusHistory: [transition('WON', '2026-07-01T00:00:00.000Z', 'PURSUING')],
    });
    expect(deriveFlags([item]).map((f) => f.type)).toContain('TERMINAL_MISSING_OUTCOME');
  });

  it('flags a LOST item without lossData', () => {
    const item = makeItem({
      status: 'LOST',
      statusHistory: [transition('LOST', '2026-07-01T00:00:00.000Z', 'PURSUING')],
    });
    expect(deriveFlags([item]).map((f) => f.type)).toContain('TERMINAL_MISSING_OUTCOME');
  });
});

describe('deriveFlags — healthy pipeline', () => {
  it('returns no flags for a well-formed active item', () => {
    const item = makeItem({
      status: 'PURSUING',
      approvalStatus: 'I_APPROVED',
      responseDeadlineIso: '2026-08-01T00:00:00.000Z',
    });
    expect(deriveFlags([item])).toEqual([]);
  });
});

describe('groupFlagsByType', () => {
  it('buckets flags by type with all four keys present', () => {
    const items = [
      makeItem({ id: 'a', status: 'PURSUING', assigneeId: undefined, responseDeadlineIso: '2026-08-01T00:00:00.000Z' }),
      makeItem({ id: 'b', status: 'PURSUING', responseDeadlineIso: undefined }),
    ];
    const grouped = groupFlagsByType(deriveFlags(items));
    expect(Object.keys(grouped).sort()).toEqual([
      'MISSING_DEADLINE',
      'MISSING_OWNER',
      'SUBMITTED_WITHOUT_APPROVAL',
      'TERMINAL_MISSING_OUTCOME',
    ]);
    expect(grouped.MISSING_OWNER.length).toBeGreaterThanOrEqual(1);
  });
});

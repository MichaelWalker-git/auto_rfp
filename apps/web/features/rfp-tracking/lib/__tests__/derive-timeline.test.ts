import { buildTransitionTimeline } from '../derive-timeline';
import { makeItem, transition, approvalTransition } from '../../__tests__/fixtures';

describe('buildTransitionTimeline', () => {
  it('returns an empty array when both histories are empty', () => {
    expect(buildTransitionTimeline(makeItem({ statusHistory: [], approvalHistory: [] }))).toEqual([]);
  });

  it('treats missing histories as empty', () => {
    const item = makeItem({ statusHistory: undefined, approvalHistory: undefined });
    expect(buildTransitionTimeline(item)).toEqual([]);
  });

  it('merges status and approval histories into one list', () => {
    const item = makeItem({
      statusHistory: [transition('SUBMITTED', '2026-07-10T00:00:00.000Z', 'PURSUING')],
      approvalHistory: [approvalTransition('I_APPROVED', '2026-07-11T00:00:00.000Z', 'INITIAL_APPROVAL', 'INITIAL')],
    });
    const timeline = buildTransitionTimeline(item);
    expect(timeline).toHaveLength(2);
    expect(timeline.map((e) => e.kind).sort()).toEqual(['approval', 'status']);
  });

  it('sorts DESC by changedAt (most recent first)', () => {
    const item = makeItem({
      statusHistory: [
        transition('IDENTIFIED', '2026-07-01T00:00:00.000Z'),
        transition('SUBMITTED', '2026-07-20T00:00:00.000Z', 'PURSUING'),
      ],
      approvalHistory: [
        approvalTransition('I_APPROVED', '2026-07-10T00:00:00.000Z', 'INITIAL_APPROVAL', 'INITIAL'),
      ],
    });
    const timeline = buildTransitionTimeline(item);
    expect(timeline.map((e) => e.changedAt)).toEqual([
      '2026-07-20T00:00:00.000Z',
      '2026-07-10T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
    ]);
  });

  it('formats a status transition label using OPPORTUNITY_STATUS_LABELS', () => {
    const item = makeItem({
      statusHistory: [transition('SUBMITTED', '2026-07-20T00:00:00.000Z', 'PURSUING')],
      approvalHistory: [],
    });
    const [entry] = buildTransitionTimeline(item);
    expect(entry!.label).toBe('Status: Pursuing → Submitted');
    expect(entry!.fromLabel).toBe('Pursuing');
    expect(entry!.toLabel).toBe('Submitted');
  });

  it('formats an approval transition label using OPPORTUNITY_APPROVAL_LABELS', () => {
    const item = makeItem({
      statusHistory: [],
      approvalHistory: [approvalTransition('PRE_SUB_APPROVAL', '2026-07-20T00:00:00.000Z', 'I_APPROVED', 'STAGE')],
    });
    const [entry] = buildTransitionTimeline(item);
    expect(entry!.label).toBe('Approval: I Approved → Pre Sub Approval');
  });

  it('handles the initial (from: null) entry gracefully', () => {
    const item = makeItem({
      statusHistory: [],
      approvalHistory: [approvalTransition('INITIAL_APPROVAL', '2026-07-20T00:00:00.000Z', null, 'INITIAL')],
    });
    const [entry] = buildTransitionTimeline(item);
    expect(entry!.fromLabel).toBeNull();
    expect(entry!.label).toBe('Approval: → Initial Approval');
  });

  it('humanizes the "system" actor to "System"', () => {
    const item = makeItem({
      statusHistory: [
        { from: null, to: 'IDENTIFIED', changedAt: '2026-07-01T00:00:00.000Z', changedBy: 'system', source: 'SYSTEM' },
      ],
      approvalHistory: [],
    });
    const [entry] = buildTransitionTimeline(item);
    expect(entry!.actor).toBe('System');
  });

  it('preserves the reason when present', () => {
    const item = makeItem({
      statusHistory: [],
      approvalHistory: [
        { from: 'INITIAL_APPROVAL', to: 'NOT_APPROVED', changedAt: '2026-07-05T00:00:00.000Z', changedBy: 'user-1', gate: 'INITIAL', reason: 'Out of scope' },
      ],
    });
    const [entry] = buildTransitionTimeline(item);
    expect(entry!.reason).toBe('Out of scope');
  });
});

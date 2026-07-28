import {
  deriveInitialQueue,
  deriveFinalQueue,
  pendingApprovalCount,
} from '../derive-approval-queue';
import { makeItem, approvalTransition } from '../../__tests__/fixtures';

const NOW = '2026-07-27T00:00:00.000Z';

describe('deriveInitialQueue', () => {
  it('includes only INITIAL_APPROVAL items', () => {
    const items = [
      makeItem({ id: 'a', approvalStatus: 'INITIAL_APPROVAL' }),
      makeItem({ id: 'b', approvalStatus: 'I_APPROVED' }),
      makeItem({ id: 'c', approvalStatus: 'PRE_SUB_APPROVAL' }),
    ];
    const queue = deriveInitialQueue(items, NOW);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.item.id).toBe('a');
  });

  it('includes items with a missing approvalStatus (default INITIAL_APPROVAL)', () => {
    const queue = deriveInitialQueue([makeItem({ id: 'x', approvalStatus: undefined })], NOW);
    expect(queue).toHaveLength(1);
  });

  it('sorts oldest-waiting first', () => {
    const items = [
      makeItem({
        id: 'newer',
        approvalStatus: 'INITIAL_APPROVAL',
        approvalHistory: [approvalTransition('INITIAL_APPROVAL', '2026-07-20T00:00:00.000Z')],
      }),
      makeItem({
        id: 'older',
        approvalStatus: 'INITIAL_APPROVAL',
        approvalHistory: [approvalTransition('INITIAL_APPROVAL', '2026-07-01T00:00:00.000Z')],
      }),
    ];
    const queue = deriveInitialQueue(items, NOW);
    expect(queue.map((e) => e.item.id)).toEqual(['older', 'newer']);
  });

  it('computes daysWaiting from the entry into the stage', () => {
    const items = [
      makeItem({
        id: 'a',
        approvalStatus: 'INITIAL_APPROVAL',
        approvalHistory: [approvalTransition('INITIAL_APPROVAL', '2026-07-17T00:00:00.000Z')],
      }),
    ];
    expect(deriveInitialQueue(items, NOW)[0]!.daysWaiting).toBe(10);
  });

  it('carries deadline urgency and days-to-deadline for each entry', () => {
    const items = [
      makeItem({
        id: 'urgent',
        approvalStatus: 'INITIAL_APPROVAL',
        responseDeadlineIso: '2026-07-28T00:00:00.000Z', // 1 day out
      }),
      makeItem({
        id: 'none',
        approvalStatus: 'INITIAL_APPROVAL',
        responseDeadlineIso: undefined,
      }),
    ];
    const byId = Object.fromEntries(deriveInitialQueue(items, NOW).map((e) => [e.item.id, e]));
    expect(byId.urgent!.deadlineUrgency).toBe('urgent');
    expect(byId.urgent!.daysToDeadline).toBe(1);
    expect(byId.none!.deadlineUrgency).toBe('none');
    expect(byId.none!.daysToDeadline).toBeNull();
  });

  it('sinks items with an unknown entry time to the bottom', () => {
    const items = [
      makeItem({
        id: 'unknown',
        approvalStatus: 'INITIAL_APPROVAL',
        approvalHistory: [],
        statusHistory: [],
        updatedAt: undefined,
        createdAt: undefined,
      }),
      makeItem({
        id: 'known',
        approvalStatus: 'INITIAL_APPROVAL',
        approvalHistory: [approvalTransition('INITIAL_APPROVAL', '2026-07-01T00:00:00.000Z')],
      }),
    ];
    const queue = deriveInitialQueue(items, NOW);
    expect(queue[0]!.item.id).toBe('known');
    expect(queue[1]!.item.id).toBe('unknown');
    expect(queue[1]!.daysWaiting).toBeNull();
  });
});

describe('deriveFinalQueue', () => {
  it('includes only PRE_SUB_APPROVAL items', () => {
    const items = [
      makeItem({ id: 'a', approvalStatus: 'PRE_SUB_APPROVAL' }),
      makeItem({ id: 'b', approvalStatus: 'I_APPROVED' }),
      makeItem({ id: 'c', approvalStatus: 'INITIAL_APPROVAL' }),
    ];
    const queue = deriveFinalQueue(items, NOW);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.item.id).toBe('a');
  });
});

describe('pendingApprovalCount', () => {
  it('counts initial + final gates separately and totals them', () => {
    const items = [
      makeItem({ id: 'a', approvalStatus: 'INITIAL_APPROVAL' }),
      makeItem({ id: 'b', approvalStatus: 'INITIAL_APPROVAL' }),
      makeItem({ id: 'c', approvalStatus: 'PRE_SUB_APPROVAL' }),
      makeItem({ id: 'd', approvalStatus: 'SUBMITTED' }),
    ];
    expect(pendingApprovalCount(items)).toEqual({ initial: 2, final: 1, total: 3 });
  });

  it('counts a missing approvalStatus as INITIAL_APPROVAL', () => {
    expect(pendingApprovalCount([makeItem({ approvalStatus: undefined })])).toEqual({
      initial: 1,
      final: 0,
      total: 1,
    });
  });

  it('returns zeros for an empty pipeline', () => {
    expect(pendingApprovalCount([])).toEqual({ initial: 0, final: 0, total: 0 });
  });
});

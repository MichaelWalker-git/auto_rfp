import {
  entryIntoCurrentStageIso,
  deadlineUrgency,
  toBoardCard,
  groupByApprovalStatus,
  resolveApprovalStatus,
} from '../derive-board';
import { APPROVAL_ORDER } from '@auto-rfp/core';
import { makeItem, transition, approvalTransition } from '../../__tests__/fixtures';

const NOW = '2026-07-27T00:00:00.000Z';

describe('resolveApprovalStatus', () => {
  it('defaults a missing approvalStatus to INITIAL_APPROVAL', () => {
    expect(resolveApprovalStatus(makeItem({ approvalStatus: undefined }))).toBe('INITIAL_APPROVAL');
  });

  it('returns the item approvalStatus when present', () => {
    expect(resolveApprovalStatus(makeItem({ approvalStatus: 'I_APPROVED' }))).toBe('I_APPROVED');
  });
});

describe('entryIntoCurrentStageIso', () => {
  it('returns the changedAt of the last approval transition into the current stage', () => {
    const item = makeItem({
      approvalStatus: 'PRE_SUB_APPROVAL',
      approvalHistory: [
        approvalTransition('I_APPROVED', '2026-07-01T00:00:00.000Z', 'INITIAL_APPROVAL', 'INITIAL'),
        approvalTransition('PRE_SUB_APPROVAL', '2026-07-10T00:00:00.000Z', 'I_APPROVED', 'STAGE'),
      ],
    });
    expect(entryIntoCurrentStageIso(item)).toBe('2026-07-10T00:00:00.000Z');
  });

  it('falls back to the last statusHistory change when no approval history matches', () => {
    const item = makeItem({
      approvalStatus: 'INITIAL_APPROVAL',
      approvalHistory: [],
      statusHistory: [transition('QUALIFYING', '2026-07-05T00:00:00.000Z', 'IDENTIFIED')],
    });
    expect(entryIntoCurrentStageIso(item)).toBe('2026-07-05T00:00:00.000Z');
  });

  it('falls back to updatedAt then createdAt when no history exists', () => {
    const item = makeItem({
      approvalStatus: 'INITIAL_APPROVAL',
      approvalHistory: [],
      statusHistory: [],
      updatedAt: '2026-07-02T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    expect(entryIntoCurrentStageIso(item)).toBe('2026-07-02T00:00:00.000Z');
  });
});

describe('deadlineUrgency', () => {
  it('flags a past deadline as overdue with a negative day count', () => {
    const { urgency, daysToDeadline } = deadlineUrgency('2026-07-20T00:00:00.000Z', NOW);
    expect(urgency).toBe('overdue');
    expect(daysToDeadline).toBe(-7);
  });

  it('flags a deadline within 2 days as urgent', () => {
    expect(deadlineUrgency('2026-07-28T00:00:00.000Z', NOW).urgency).toBe('urgent');
  });

  it('flags a deadline within 7 days as soon', () => {
    expect(deadlineUrgency('2026-08-01T00:00:00.000Z', NOW).urgency).toBe('soon');
  });

  it('flags a distant deadline as safe', () => {
    expect(deadlineUrgency('2026-09-01T00:00:00.000Z', NOW).urgency).toBe('safe');
  });

  it('returns none when there is no deadline', () => {
    expect(deadlineUrgency(null, NOW)).toEqual({ urgency: 'none', daysToDeadline: null });
  });
});

describe('toBoardCard', () => {
  it('computes days-in-stage and deadline urgency together', () => {
    const item = makeItem({
      approvalStatus: 'PRE_SUB_APPROVAL',
      responseDeadlineIso: '2026-07-28T00:00:00.000Z',
      approvalHistory: [approvalTransition('PRE_SUB_APPROVAL', '2026-07-17T00:00:00.000Z', 'I_APPROVED', 'STAGE')],
    });
    const card = toBoardCard(item, NOW);
    expect(card.approvalStatus).toBe('PRE_SUB_APPROVAL');
    expect(card.daysInCurrentStage).toBe(10);
    expect(card.deadlineUrgency).toBe('urgent');
  });

  it('defaults a missing approvalStatus to INITIAL_APPROVAL', () => {
    const card = toBoardCard(makeItem({ approvalStatus: undefined }), NOW);
    expect(card.approvalStatus).toBe('INITIAL_APPROVAL');
  });
});

describe('groupByApprovalStatus', () => {
  it('buckets items under their approval stage and leaves empty stages as empty arrays', () => {
    const items = [
      makeItem({ id: 'a', approvalStatus: 'INITIAL_APPROVAL' }),
      makeItem({ id: 'b', approvalStatus: 'I_APPROVED' }),
      makeItem({ id: 'c', approvalStatus: 'I_APPROVED' }),
    ];
    const grouped = groupByApprovalStatus(items, APPROVAL_ORDER, NOW);
    expect(grouped.INITIAL_APPROVAL).toHaveLength(1);
    expect(grouped.I_APPROVED).toHaveLength(2);
    expect(grouped.SUBMITTED).toEqual([]);
  });

  it('defaults a missing approvalStatus into the INITIAL_APPROVAL column', () => {
    const items = [makeItem({ id: 'x', approvalStatus: undefined })];
    const grouped = groupByApprovalStatus(items, APPROVAL_ORDER, NOW);
    expect(grouped.INITIAL_APPROVAL).toHaveLength(1);
  });
});

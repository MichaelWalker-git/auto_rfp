import {
  entryIntoCurrentStageIso,
  deadlineUrgency,
  toBoardCard,
  groupByStage,
  resolveApprovalStatus,
  resolveStage,
} from '../derive-board';
import { RFP_BOARD_STAGE_ORDER } from '@auto-rfp/core';
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

  it('resolves the latest matching entry by changedAt even when history is out of order', () => {
    const item = makeItem({
      approvalStatus: 'PRE_SUB_APPROVAL',
      approvalHistory: [
        // Newest transition into the current status appears FIRST (backfilled/out of order).
        approvalTransition('PRE_SUB_APPROVAL', '2026-07-20T00:00:00.000Z', 'I_APPROVED', 'STAGE'),
        approvalTransition('I_APPROVED', '2026-07-05T00:00:00.000Z', 'INITIAL_APPROVAL', 'INITIAL'),
        approvalTransition('PRE_SUB_APPROVAL', '2026-07-12T00:00:00.000Z', 'I_APPROVED', 'STAGE'),
      ],
    });
    // Must pick the max changedAt among matches, not the last array position.
    expect(entryIntoCurrentStageIso(item)).toBe('2026-07-20T00:00:00.000Z');
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

  it('is stable across the time of day the dashboard loads (calendar-day comparison)', () => {
    // Deadline is at UTC midnight two calendar days out.
    const deadline = '2026-07-29T00:00:00.000Z';
    const atMidnight = deadlineUrgency(deadline, '2026-07-27T00:00:00.000Z');
    const atEvening = deadlineUrgency(deadline, '2026-07-27T18:00:00.000Z');
    // Both loads on the same calendar day must agree — no drift from wall-clock time.
    expect(atEvening).toEqual(atMidnight);
    expect(atMidnight.daysToDeadline).toBe(2);
    expect(atMidnight.urgency).toBe('urgent');
  });

  it('treats a deadline that is only hours in the past as overdue', () => {
    // Deadline was 6h ago on the PREVIOUS UTC calendar day; a raw ms floor would
    // yield 0 ("due today"), but calendar-day differencing correctly flips overdue.
    const { urgency, daysToDeadline } = deadlineUrgency(
      '2026-07-26T22:00:00.000Z',
      '2026-07-27T04:00:00.000Z',
    );
    expect(urgency).toBe('overdue');
    expect(daysToDeadline).toBe(-1);
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

  it('measures daysInCurrentStage on the APPROVAL axis, not the board stage (documenting behavior)', () => {
    // The card sits in the `submitted` board column, but its approval axis is
    // untouched (INITIAL_APPROVAL, no matching approvalHistory). daysInCurrentStage
    // therefore reflects the approval/last-update age (updatedAt), NOT how long the
    // card has been in the `submitted` stage. This documents the known axis mismatch.
    const item = makeItem({
      pipelineStage: 'submitted',
      approvalStatus: 'INITIAL_APPROVAL',
      approvalHistory: [],
      statusHistory: [],
      updatedAt: '2026-07-25T00:00:00.000Z', // 2 days before NOW
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    const card = toBoardCard(item, NOW);
    expect(card.stage).toBe('submitted');
    // 2 days since updatedAt — NOT stage-dwell time for `submitted`.
    expect(card.daysInCurrentStage).toBe(2);
  });
});

describe('resolveStage', () => {
  it('defaults a missing pipelineStage to the first visible column', () => {
    expect(resolveStage(makeItem({ pipelineStage: undefined }))).toBe('execSummaryToReview');
  });

  it('returns the item pipelineStage when present', () => {
    expect(resolveStage(makeItem({ pipelineStage: 'submitted' }))).toBe('submitted');
  });
});

describe('groupByStage', () => {
  it('buckets items under their board stage and leaves empty stages as empty arrays', () => {
    const items = [
      makeItem({ id: 'a', pipelineStage: 'execSummaryToReview' }),
      makeItem({ id: 'b', pipelineStage: 'firstApproved' }),
      makeItem({ id: 'c', pipelineStage: 'firstApproved' }),
    ];
    const grouped = groupByStage(items, RFP_BOARD_STAGE_ORDER, NOW);
    expect(grouped.execSummaryToReview).toHaveLength(1);
    expect(grouped.firstApproved).toHaveLength(2);
    expect(grouped.awarded).toEqual([]);
  });

  it('defaults a missing pipelineStage into the first visible column', () => {
    const items = [makeItem({ id: 'x', pipelineStage: undefined })];
    const grouped = groupByStage(items, RFP_BOARD_STAGE_ORDER, NOW);
    expect(grouped.execSummaryToReview).toHaveLength(1);
  });
});

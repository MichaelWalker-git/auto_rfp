import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FOIA_DELAY_DAYS,
  FOIA_AUTOMATION_STATE_COLORS,
  FOIA_AUTOMATION_STATE_LABELS,
  FOIA_BLOCKED_REASON_LABELS,
  FOIA_ELIGIBLE_OPPORTUNITY_STATUSES,
  FoiaAutomationCreateRequestSchema,
  FoiaAutomationItemSchema,
  FoiaAutomationStateSchema,
  FoiaAutomationUpdateRequestSchema,
  FoiaBlockedReasonSchema,
  computeFoiaScheduledSendAt,
  isFoiaEligibleStatus,
  isFoiaFailureState,
  isFoiaPendingState,
} from './foia-automation';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('computeFoiaScheduledSendAt', () => {
  it('anchors on submittedAt when a submission exists', () => {
    const result = computeFoiaScheduledSendAt({
      submittedAt: '2026-01-01T00:00:00.000Z',
      responseDeadlineIso: '2026-06-01T00:00:00.000Z',
      delayDays: 90,
    });

    // submittedAt wins even though the deadline is later.
    expect(result).toBe('2026-04-01T00:00:00.000Z');
  });

  it('falls back to responseDeadlineIso when there is no submission', () => {
    const result = computeFoiaScheduledSendAt({
      submittedAt: null,
      responseDeadlineIso: '2026-01-01T00:00:00.000Z',
      delayDays: 90,
    });

    expect(result).toBe('2026-04-01T00:00:00.000Z');
  });

  it('returns null when neither anchor is available', () => {
    expect(
      computeFoiaScheduledSendAt({ submittedAt: null, responseDeadlineIso: null, delayDays: 90 }),
    ).toBeNull();
  });

  it('returns null when both anchors are undefined', () => {
    expect(computeFoiaScheduledSendAt({ delayDays: 90 })).toBeNull();
  });

  it('skips an unparseable submittedAt and uses the deadline instead', () => {
    const result = computeFoiaScheduledSendAt({
      submittedAt: 'not-a-date',
      responseDeadlineIso: '2026-01-01T00:00:00.000Z',
      delayDays: 30,
    });

    expect(result).toBe('2026-01-31T00:00:00.000Z');
  });

  it('returns null when every candidate is unparseable', () => {
    expect(
      computeFoiaScheduledSendAt({
        submittedAt: 'nope',
        responseDeadlineIso: 'also-nope',
        delayDays: 30,
      }),
    ).toBeNull();
  });

  it('accepts a date-only anchor (flexibleDateSchema allows these)', () => {
    const result = computeFoiaScheduledSendAt({
      submittedAt: '2026-01-01',
      responseDeadlineIso: null,
      delayDays: 1,
    });

    expect(result).toBe('2026-01-02T00:00:00.000Z');
  });

  it('honours an offset-bearing anchor by normalizing to UTC', () => {
    // 2026-01-01T00:00:00-05:00 is 2026-01-01T05:00:00Z
    const result = computeFoiaScheduledSendAt({
      submittedAt: '2026-01-01T00:00:00-05:00',
      responseDeadlineIso: null,
      delayDays: 0,
    });

    expect(result).toBe('2026-01-01T05:00:00.000Z');
  });

  it('returns a past timestamp when the anchor is already older than the delay', () => {
    const anchor = new Date(Date.UTC(2020, 0, 1)).toISOString();
    const result = computeFoiaScheduledSendAt({
      submittedAt: anchor,
      responseDeadlineIso: null,
      delayDays: 90,
    });

    // The scanner treats `<= now` as due, so a past value means "send now".
    expect(result).not.toBeNull();
    expect(new Date(result as string).getTime()).toBeLessThan(Date.now());
  });

  it('spans a leap day without drifting', () => {
    // 2028 is a leap year; Feb 2028 has 29 days.
    const result = computeFoiaScheduledSendAt({
      submittedAt: '2028-02-01T00:00:00.000Z',
      responseDeadlineIso: null,
      delayDays: 29,
    });

    expect(result).toBe('2028-03-01T00:00:00.000Z');
  });

  it('treats a zero delay as due at the anchor', () => {
    const result = computeFoiaScheduledSendAt({
      submittedAt: '2026-01-01T00:00:00.000Z',
      responseDeadlineIso: null,
      delayDays: 0,
    });

    expect(result).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns null for a negative delay rather than scheduling in the past', () => {
    expect(
      computeFoiaScheduledSendAt({
        submittedAt: '2026-01-01T00:00:00.000Z',
        responseDeadlineIso: null,
        delayDays: -30,
      }),
    ).toBeNull();
  });

  it('returns null for a non-finite delay', () => {
    expect(
      computeFoiaScheduledSendAt({
        submittedAt: '2026-01-01T00:00:00.000Z',
        responseDeadlineIso: null,
        delayDays: Number.NaN,
      }),
    ).toBeNull();
  });

  it('adds exactly delayDays worth of milliseconds', () => {
    const submittedAt = '2026-03-15T12:34:56.000Z';
    const result = computeFoiaScheduledSendAt({
      submittedAt,
      responseDeadlineIso: null,
      delayDays: DEFAULT_FOIA_DELAY_DAYS,
    });

    const delta = new Date(result as string).getTime() - new Date(submittedAt).getTime();
    expect(delta).toBe(DEFAULT_FOIA_DELAY_DAYS * MS_PER_DAY);
  });
});

describe('isFoiaEligibleStatus', () => {
  it('allows WON and LOST', () => {
    expect(isFoiaEligibleStatus('WON')).toBe(true);
    expect(isFoiaEligibleStatus('LOST')).toBe(true);
  });

  it('rejects statuses with no evaluation record to request', () => {
    for (const status of ['IDENTIFIED', 'QUALIFYING', 'PURSUING', 'SUBMITTED', 'NO_BID', 'WITHDRAWN']) {
      expect(isFoiaEligibleStatus(status)).toBe(false);
    }
  });

  it('rejects a missing status', () => {
    expect(isFoiaEligibleStatus(undefined)).toBe(false);
    expect(isFoiaEligibleStatus(null)).toBe(false);
    expect(isFoiaEligibleStatus('')).toBe(false);
  });

  it('exposes exactly WON and LOST as the eligible set', () => {
    expect([...FOIA_ELIGIBLE_OPPORTUNITY_STATUSES]).toEqual(['WON', 'LOST']);
  });
});

describe('state groupings', () => {
  it('classifies every failure state as a failure and not as pending', () => {
    for (const state of ['BLOCKED', 'STALLED', 'BOUNCED', 'FAILED'] as const) {
      expect(isFoiaFailureState(state)).toBe(true);
      expect(isFoiaPendingState(state)).toBe(false);
    }
  });

  it('classifies pre-send states as pending and not as failures', () => {
    for (const state of ['SCHEDULED', 'AWAITING_APPROVAL', 'SENDING'] as const) {
      expect(isFoiaPendingState(state)).toBe(true);
      expect(isFoiaFailureState(state)).toBe(false);
    }
  });

  it('treats SENT as neither pending nor failed', () => {
    expect(isFoiaPendingState('SENT')).toBe(false);
    expect(isFoiaFailureState('SENT')).toBe(false);
  });

  it('has a label and a colour for every state', () => {
    for (const state of FoiaAutomationStateSchema.options) {
      expect(FOIA_AUTOMATION_STATE_LABELS[state]).toBeTruthy();
      expect(FOIA_AUTOMATION_STATE_COLORS[state]).toBeTruthy();
    }
  });

  it('has a user-facing label for every blocked reason', () => {
    for (const reason of FoiaBlockedReasonSchema.options) {
      expect(FOIA_BLOCKED_REASON_LABELS[reason]).toBeTruthy();
    }
  });
});

describe('FoiaAutomationCreateRequestSchema', () => {
  const valid = {
    orgId: 'org-1',
    projectId: 'proj-1',
    oppId: 'opp-1',
    state: 'SCHEDULED' as const,
  };

  it('accepts a minimal record and defaults triggeredBy to TIMER', () => {
    const { success, data } = FoiaAutomationCreateRequestSchema.safeParse(valid);

    expect(success).toBe(true);
    expect(data?.triggeredBy).toBe('TIMER');
  });

  it('accepts a null scheduledSendAt for NOT_APPLICABLE records', () => {
    const { success } = FoiaAutomationCreateRequestSchema.safeParse({
      ...valid,
      state: 'NOT_APPLICABLE',
      scheduledSendAt: null,
    });

    expect(success).toBe(true);
  });

  it('rejects an unknown state', () => {
    const { success } = FoiaAutomationCreateRequestSchema.safeParse({
      ...valid,
      state: 'DEFINITELY_NOT_A_STATE',
    });

    expect(success).toBe(false);
  });

  it('rejects a missing orgId', () => {
    const { orgId: _orgId, ...withoutOrg } = valid;
    const { success } = FoiaAutomationCreateRequestSchema.safeParse(withoutOrg);

    expect(success).toBe(false);
  });

  it('rejects a negative delay override', () => {
    const { success } = FoiaAutomationCreateRequestSchema.safeParse({
      ...valid,
      delayDaysOverride: -1,
    });

    expect(success).toBe(false);
  });
});

describe('FoiaAutomationUpdateRequestSchema', () => {
  const ids = { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' };

  it('does not accept a state field — transitions are backend-only', () => {
    const { success, data } = FoiaAutomationUpdateRequestSchema.safeParse({
      ...ids,
      state: 'SENT',
    });

    expect(success).toBe(true);
    // Zod strips unknown keys, so a client cannot force a state change.
    expect((data as Record<string, unknown>).state).toBeUndefined();
  });

  it('accepts a delay override', () => {
    const { success, data } = FoiaAutomationUpdateRequestSchema.safeParse({
      ...ids,
      delayDaysOverride: 45,
    });

    expect(success).toBe(true);
    expect(data?.delayDaysOverride).toBe(45);
  });

  it('accepts a null delay override to clear it', () => {
    const { success, data } = FoiaAutomationUpdateRequestSchema.safeParse({
      ...ids,
      delayDaysOverride: null,
    });

    expect(success).toBe(true);
    expect(data?.delayDaysOverride).toBeNull();
  });

  it('accepts the cancel and markManualCompleted intents', () => {
    expect(FoiaAutomationUpdateRequestSchema.safeParse({ ...ids, cancel: true }).success).toBe(true);
    expect(
      FoiaAutomationUpdateRequestSchema.safeParse({ ...ids, markManualCompleted: true }).success,
    ).toBe(true);
  });

  it('rejects a delay override above the ten-year ceiling', () => {
    const { success } = FoiaAutomationUpdateRequestSchema.safeParse({
      ...ids,
      delayDaysOverride: 4000,
    });

    expect(success).toBe(false);
  });
});

describe('FoiaAutomationItemSchema', () => {
  const base = {
    orgId: 'org-1',
    projectId: 'proj-1',
    oppId: 'opp-1',
    state: 'SCHEDULED' as const,
  };

  it('defaults attemptCount to zero', () => {
    const { success, data } = FoiaAutomationItemSchema.safeParse(base);

    expect(success).toBe(true);
    expect(data?.attemptCount).toBe(0);
  });

  it('accepts a fully populated blocked record with candidates', () => {
    const { success } = FoiaAutomationItemSchema.safeParse({
      ...base,
      state: 'BLOCKED',
      blockedReason: 'NEEDS_CONFIRMATION',
      becameDueAt: '2026-04-01T00:00:00.000Z',
      recipientCandidates: [
        { email: 'foia@army.mil', context: 'FOIA requests to foia@army.mil', score: 12 },
      ],
    });

    expect(success).toBe(true);
  });

  it('rejects an invalid candidate email', () => {
    const { success } = FoiaAutomationItemSchema.safeParse({
      ...base,
      recipientCandidates: [{ email: 'not-an-email', context: 'x', score: 1 }],
    });

    expect(success).toBe(false);
  });

  it('accepts a sent record with artifacts', () => {
    const { success } = FoiaAutomationItemSchema.safeParse({
      ...base,
      state: 'SENT',
      sentAt: '2026-04-01T00:00:00.000Z',
      sesMessageId: 'ses-msg-1',
      recipientSource: 'ORG_AGENCY_CONTACT',
      artifacts: [
        {
          kind: 'LETTER_PDF',
          s3Key: 'org/proj/opp/foia/f1/letter.pdf',
          fileName: 'letter.pdf',
          contentType: 'application/pdf',
          createdAt: '2026-04-01T00:00:00.000Z',
        },
      ],
    });

    expect(success).toBe(true);
  });

  it('rejects an unknown artifact kind', () => {
    const { success } = FoiaAutomationItemSchema.safeParse({
      ...base,
      artifacts: [
        {
          kind: 'SOMETHING_ELSE',
          s3Key: 'k',
          fileName: 'f',
          contentType: 'text/plain',
          createdAt: '2026-04-01T00:00:00.000Z',
        },
      ],
    });

    expect(success).toBe(false);
  });
});

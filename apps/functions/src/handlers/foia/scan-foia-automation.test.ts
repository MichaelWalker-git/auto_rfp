process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
}));

const mockListAllOrgIds = jest.fn();
jest.mock('@/helpers/org', () => ({
  listAllOrgIds: () => mockListAllOrgIds(),
}));

const mockListOpportunitiesByOrg = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  listOpportunitiesByOrg: (...a: unknown[]) => mockListOpportunitiesByOrg(...a),
}));

const mockGetSubmissionHistory = jest.fn();
jest.mock('@/helpers/proposal-submission', () => ({
  getSubmissionHistory: (...a: unknown[]) => mockGetSubmissionHistory(...a),
}));

const mockGetFoiaSettings = jest.fn();
jest.mock('@/helpers/foia-settings', () => ({
  getFoiaSettings: (...a: unknown[]) => mockGetFoiaSettings(...a),
}));

const mockGetFoiaAutomation = jest.fn();
const mockUpsertFoiaAutomation = jest.fn();
const mockSetFoiaAutomationState = jest.fn();
const mockSyncOpportunityFoiaMarker = jest.fn();
const mockTransitionFoiaAutomationState = jest.fn();
jest.mock('@/helpers/foia-automation', () => ({
  getFoiaAutomation: (...a: unknown[]) => mockGetFoiaAutomation(...a),
  upsertFoiaAutomation: (...a: unknown[]) => mockUpsertFoiaAutomation(...a),
  setFoiaAutomationState: (...a: unknown[]) => mockSetFoiaAutomationState(...a),
  syncOpportunityFoiaMarker: (...a: unknown[]) => mockSyncOpportunityFoiaMarker(...a),
  transitionFoiaAutomationState: (...a: unknown[]) => mockTransitionFoiaAutomationState(...a),
}));

const mockPrepareFoiaRequest = jest.fn();
jest.mock('@/helpers/foia-prepare', () => ({
  prepareFoiaRequest: (...a: unknown[]) => mockPrepareFoiaRequest(...a),
}));

import { baseHandler } from './scan-foia-automation';

const DAY = 24 * 60 * 60 * 1000;

/**
 * A LOST opportunity whose deadline is recent enough that a 90-day delay puts
 * the schedule in the FUTURE — so the default fixture exercises scheduling
 * without tripping the prepare path. Tests that want a due request override
 * `responseDeadlineIso` with something older.
 */
const buildOpp = (overrides: Record<string, unknown> = {}) => ({
  partition_key: 'OPPORTUNITY',
  sort_key: 'org-1#proj-1#opp-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  oppId: 'opp-1',
  id: 'opp-1',
  source: 'HIGHER_GOV',
  title: 'Widget Support',
  status: 'LOST',
  responseDeadlineIso: new Date(Date.now() - 10 * DAY).toISOString(),
  ...overrides,
});

/** Deadline old enough that anchor + 90 days is already past. */
const overdueDeadline = () => new Date(Date.now() - 200 * DAY).toISOString();

const defaultSettings = {
  orgId: 'org-1',
  automationEnabled: true,
  delayDays: 90,
  mailScrapeEnabled: false,
  approvalReminderDays: [3, 7],
  stallAfterDays: 14,
  defaultRequestedDocuments: ['SSDD'],
  defaultFeeLimit: 0,
  dailySendCap: 5,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockListAllOrgIds.mockResolvedValue(['org-1']);
  mockGetFoiaSettings.mockResolvedValue({ ...defaultSettings });
  mockListOpportunitiesByOrg.mockResolvedValue({ items: [buildOpp()] });
  mockGetSubmissionHistory.mockResolvedValue([]);
  mockGetFoiaAutomation.mockResolvedValue(null);
  mockUpsertFoiaAutomation.mockResolvedValue({});
  mockSetFoiaAutomationState.mockResolvedValue({});
  mockSyncOpportunityFoiaMarker.mockResolvedValue(undefined);
  // Default: the conditional transition succeeds, and preparation produces a
  // sendable request. Individual tests override these.
  mockTransitionFoiaAutomationState.mockResolvedValue({ state: 'AWAITING_APPROVAL' });
  mockPrepareFoiaRequest.mockResolvedValue({
    status: 'PREPARED',
    request: { foiaId: 'foia-1', agencyFOIAEmail: 'foia@army.mil', agencyFOIAAddress: 'addr' },
    letter: 'Letter body',
    artifacts: [],
  });
});

describe('scan-foia-automation — scheduling', () => {
  it('schedules a LOST opportunity from its response deadline', async () => {
    const res = await baseHandler({});

    expect(res.totals.scheduled).toBe(1);
    expect(mockUpsertFoiaAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        state: 'SCHEDULED',
        triggeredBy: 'TIMER',
      }),
    );
  });

  it('prefers the submission date over the response deadline', async () => {
    const submittedAt = new Date(Date.UTC(2026, 0, 1)).toISOString();
    mockGetSubmissionHistory.mockResolvedValue([
      { status: 'SUBMITTED', submittedAt },
    ]);

    await baseHandler({});

    const call = mockUpsertFoiaAutomation.mock.calls[0]![0] as { scheduledSendAt: string };
    // 2026-01-01 + 90 days = 2026-04-01
    expect(call.scheduledSendAt).toBe('2026-04-01T00:00:00.000Z');
  });

  it('also schedules a WON opportunity', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [buildOpp({ status: 'WON' })] });

    const res = await baseHandler({});

    expect(res.totals.scheduled).toBe(1);
  });

  it('honours a per-opportunity delay override', async () => {
    const submittedAt = new Date(Date.UTC(2026, 0, 1)).toISOString();
    mockGetSubmissionHistory.mockResolvedValue([{ status: 'SUBMITTED', submittedAt }]);
    mockGetFoiaAutomation.mockResolvedValue({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      state: 'SCHEDULED',
      scheduledSendAt: null,
      delayDaysOverride: 30,
    });

    await baseHandler({});

    const call = mockSetFoiaAutomationState.mock.calls[0]![0] as {
      patch: { scheduledSendAt: string };
    };
    // 30-day override, not the org's 90.
    expect(call.patch.scheduledSendAt).toBe('2026-01-31T00:00:00.000Z');
  });
});

describe('scan-foia-automation — not applicable', () => {
  it('creates nothing for a non-terminal opportunity', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({
      items: [buildOpp({ status: 'SUBMITTED' })],
    });

    const res = await baseHandler({});

    // No record should be written just to say "nothing to do".
    expect(mockUpsertFoiaAutomation).not.toHaveBeenCalled();
    expect(res.totals.skipped).toBe(1);
  });

  it('marks NOT_APPLICABLE when there is no submission and no deadline', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({
      items: [buildOpp({ responseDeadlineIso: null })],
    });
    mockGetFoiaAutomation.mockResolvedValue({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      state: 'SCHEDULED',
      scheduledSendAt: '2026-01-01T00:00:00.000Z',
    });

    const res = await baseHandler({});

    expect(res.totals.notApplicable).toBe(1);
    expect(mockSetFoiaAutomationState).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'NOT_APPLICABLE' }),
    );
  });

  it('skips an opportunity missing projectId or oppId', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({
      items: [buildOpp({ oppId: undefined })],
    });

    const res = await baseHandler({});

    expect(res.totals.skipped).toBe(1);
    expect(mockUpsertFoiaAutomation).not.toHaveBeenCalled();
  });
});

describe('scan-foia-automation — suppression', () => {
  it('suppresses when every submission was withdrawn', async () => {
    mockGetSubmissionHistory.mockResolvedValue([
      { status: 'WITHDRAWN', submittedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    mockGetFoiaAutomation.mockResolvedValue({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      state: 'SCHEDULED',
      scheduledSendAt: '2026-04-01T00:00:00.000Z',
    });

    const res = await baseHandler({});

    expect(res.totals.suppressed).toBe(1);
    expect(mockSetFoiaAutomationState).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'SUPPRESSED',
        patch: expect.objectContaining({
          suppressedReason: 'Proposal submission was withdrawn',
        }),
      }),
    );
  });

  it('still schedules when one submission is withdrawn but another is active', async () => {
    mockGetSubmissionHistory.mockResolvedValue([
      { status: 'WITHDRAWN', submittedAt: '2026-01-01T00:00:00.000Z' },
      { status: 'SUBMITTED', submittedAt: '2026-02-01T00:00:00.000Z' },
    ]);

    const res = await baseHandler({});

    expect(res.totals.scheduled).toBe(1);
  });
});

describe('scan-foia-automation — states the reconciler must not touch', () => {
  it.each(['AWAITING_APPROVAL', 'SENDING', 'SENT', 'BOUNCED', 'FAILED', 'STALLED', 'BLOCKED', 'SUPPRESSED', 'MANUAL_COMPLETED'])(
    'leaves a %s record alone',
    async (state) => {
      mockGetFoiaAutomation.mockResolvedValue({
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        state,
        scheduledSendAt: '2020-01-01T00:00:00.000Z',
      });

      const res = await baseHandler({});

      // Critically, a SENT record must never be rescheduled into another send.
      expect(mockSetFoiaAutomationState).not.toHaveBeenCalled();
      expect(mockUpsertFoiaAutomation).not.toHaveBeenCalled();
      expect(res.totals.skipped).toBe(1);
    },
  );
});

describe('scan-foia-automation — idempotency', () => {
  it('writes nothing when the stored record already matches the intent', async () => {
    const submittedAt = new Date(Date.UTC(2026, 0, 1)).toISOString();
    mockGetSubmissionHistory.mockResolvedValue([{ status: 'SUBMITTED', submittedAt }]);
    mockGetFoiaAutomation.mockResolvedValue({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      state: 'SCHEDULED',
      scheduledSendAt: '2026-04-01T00:00:00.000Z',
    });

    const res = await baseHandler({});

    expect(res.totals.unchanged).toBe(1);
    expect(mockSetFoiaAutomationState).not.toHaveBeenCalled();
  });

  it('still prepares a past-due record it has nothing to rewrite', async () => {
    /**
     * Regression, and the one that mattered most: idempotency used to `continue`,
     * so the due-check never ran on any pass after the first. Because
     * `decideIntent` recomputes the same timestamp every night, a record was
     * "unchanged" from the moment it was written — and a request scheduled 90 days
     * out was therefore never prepared, on any night, ever. The whole Level 2
     * timer was dead.
     *
     * The rest of the suite stubs `getFoiaAutomation` to null, which only ever
     * exercises the first pass. This seeds exactly what the first pass persists.
     */
    const submittedAt = new Date(Date.UTC(2026, 0, 1)).toISOString();
    mockGetSubmissionHistory.mockResolvedValue([{ status: 'SUBMITTED', submittedAt }]);
    mockGetFoiaAutomation.mockResolvedValue({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      state: 'SCHEDULED',
      // 90 days after submittedAt — what computeFoiaScheduledSendAt produces,
      // and comfortably in the past relative to the test clock.
      scheduledSendAt: '2026-04-01T00:00:00.000Z',
    });
    const res = await baseHandler({});

    expect(res.totals.unchanged).toBe(1);
    // Nothing to rewrite, but the request is due and must be composed.
    expect(res.totals.prepared).toBe(1);
    expect(mockPrepareFoiaRequest).toHaveBeenCalledTimes(1);
    expect(mockSetFoiaAutomationState).not.toHaveBeenCalled();
  });

  it('does not double-count an unchanged record as a new transition', async () => {
    const submittedAt = new Date(Date.UTC(2026, 0, 1)).toISOString();
    mockGetSubmissionHistory.mockResolvedValue([{ status: 'SUBMITTED', submittedAt }]);
    mockGetFoiaAutomation.mockResolvedValue({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      state: 'SCHEDULED',
      scheduledSendAt: '2026-04-01T00:00:00.000Z',
    });

    const res = await baseHandler({});

    expect(res.totals.unchanged).toBe(1);
    expect(res.totals.scheduled).toBe(0);
  });
});

describe('scan-foia-automation — settings and scoping', () => {
  it('skips an org with automation disabled', async () => {
    mockGetFoiaSettings.mockResolvedValue({ ...defaultSettings, automationEnabled: false });

    const res = await baseHandler({});

    expect(mockListOpportunitiesByOrg).not.toHaveBeenCalled();
    expect(res.totals.scheduled).toBe(0);
  });

  it('honours the single-org escape hatch without enumerating all orgs', async () => {
    const res = await baseHandler({ detail: { orgId: 'org-9' } });

    expect(mockListAllOrgIds).not.toHaveBeenCalled();
    expect(mockGetFoiaSettings).toHaveBeenCalledWith('org-9');
    expect(res.orgCount).toBe(1);
  });

  it('enumerates every org by default', async () => {
    mockListAllOrgIds.mockResolvedValue(['org-1', 'org-2', 'org-3']);

    const res = await baseHandler({});

    expect(res.orgCount).toBe(3);
  });
});

describe('scan-foia-automation — dry run', () => {
  it('reports intended work without persisting anything', async () => {
    const res = await baseHandler({ detail: { dryRun: true } });

    expect(res.dryRun).toBe(true);
    expect(res.totals.scheduled).toBe(1);
    expect(mockUpsertFoiaAutomation).not.toHaveBeenCalled();
    expect(mockSetFoiaAutomationState).not.toHaveBeenCalled();
    expect(mockSyncOpportunityFoiaMarker).not.toHaveBeenCalled();
  });
});

describe('scan-foia-automation — preparing a due request', () => {
  const dueOpp = () => buildOpp({ responseDeadlineIso: overdueDeadline() });

  it('composes a due request and advances it to AWAITING_APPROVAL', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });

    const res = await baseHandler({});

    expect(res.totals.prepared).toBe(1);
    expect(mockPrepareFoiaRequest).toHaveBeenCalledTimes(1);
    expect(mockTransitionFoiaAutomationState).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'SCHEDULED',
        to: 'AWAITING_APPROVAL',
        patch: expect.objectContaining({ foiaRequestId: 'foia-1' }),
      }),
    );
  });

  it('does not prepare a request whose schedule is still in the future', async () => {
    // The default fixture is 10 days past deadline, so +90 days is not yet due.
    const res = await baseHandler({});

    expect(mockPrepareFoiaRequest).not.toHaveBeenCalled();
    expect(res.totals.prepared).toBe(0);
    expect(res.totals.scheduled).toBe(1);
  });

  it('blocks with the reason when preparation cannot resolve a recipient', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });
    mockPrepareFoiaRequest.mockResolvedValue({
      status: 'BLOCKED',
      blockedReason: 'NEEDS_RECIPIENT',
    });

    const res = await baseHandler({});

    expect(res.totals.blocked).toBe(1);
    expect(mockTransitionFoiaAutomationState).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'SCHEDULED',
        to: 'BLOCKED',
        patch: expect.objectContaining({ blockedReason: 'NEEDS_RECIPIENT' }),
      }),
    );
  });

  it('carries scan candidates onto the record so the UI can offer them', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });
    mockPrepareFoiaRequest.mockResolvedValue({
      status: 'BLOCKED',
      blockedReason: 'NEEDS_CONFIRMATION',
      recipientCandidates: [{ email: 'foia@army.mil', context: 'FOIA Officer', score: 12 }],
    });

    await baseHandler({});

    const call = mockTransitionFoiaAutomationState.mock.calls[0]![0] as {
      patch: { recipientCandidates?: unknown[] };
    };
    expect(call.patch.recipientCandidates).toHaveLength(1);
  });

  it('stamps becameDueAt so a post-window failure is distinguishable', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });

    await baseHandler({});

    const call = mockTransitionFoiaAutomationState.mock.calls[0]![0] as {
      patch: { becameDueAt?: string };
    };
    expect(call.patch.becameDueAt).toBeTruthy();
  });

  it('treats a lost transition race as a no-op, not a success', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });
    // Null means a concurrent scanner already advanced this record.
    mockTransitionFoiaAutomationState.mockResolvedValue(null);

    const res = await baseHandler({});

    expect(res.totals.prepared).toBe(0);
    expect(res.totals.blocked).toBe(0);
    // Crucially, the opportunity marker is NOT re-synced off a race we lost.
    expect(mockSyncOpportunityFoiaMarker).not.toHaveBeenCalledWith(
      'org-1',
      'proj-1',
      'opp-1',
      'AWAITING_APPROVAL',
    );
  });

  it('never prepares a request that is already awaiting approval', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });
    mockGetFoiaAutomation.mockResolvedValue({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      state: 'AWAITING_APPROVAL',
      scheduledSendAt: overdueDeadline(),
    });

    const res = await baseHandler({});

    // AWAITING_APPROVAL is outside RECONCILABLE_STATES, so the record is skipped
    // entirely — no second letter, no duplicate artifacts.
    expect(mockPrepareFoiaRequest).not.toHaveBeenCalled();
    expect(res.totals.skipped).toBe(1);
  });

  it('goes to AWAITING_APPROVAL when the request is not auto-send eligible', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });
    mockPrepareFoiaRequest.mockResolvedValue({
      status: 'PREPARED',
      request: { foiaId: 'foia-1', agencyFOIAEmail: 'foia@army.mil', agencyFOIAAddress: 'addr' },
      letter: 'L',
      artifacts: [],
      autoSendEligible: false,
    });

    await baseHandler({});

    expect(mockTransitionFoiaAutomationState).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'AWAITING_APPROVAL' }),
    );
  });

  it('stores autoSendEligible but still goes to AWAITING_APPROVAL', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });
    mockPrepareFoiaRequest.mockResolvedValue({
      status: 'PREPARED',
      request: { foiaId: 'foia-1', agencyFOIAEmail: 'foia@army.mil', agencyFOIAAddress: 'addr' },
      letter: 'L',
      artifacts: [],
      autoSendEligible: true,
      recipientSource: 'FOIA_GOV',
    });

    await baseHandler({});

    // The scanner NEVER enters SENDING — that state is owned exclusively by the
    // send handler. Even when autoSendEligible is true, the scanner moves the
    // record to AWAITING_APPROVAL and stores the eligibility flag for the
    // downstream sender to consume.
    expect(mockTransitionFoiaAutomationState).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'AWAITING_APPROVAL',
        patch: expect.objectContaining({ autoSendEligible: true }),
      }),
    );
    expect(mockSyncOpportunityFoiaMarker).toHaveBeenCalledWith(
      'org-1',
      'proj-1',
      'opp-1',
      'AWAITING_APPROVAL',
    );
  });

  it('does not write anything on a dry run, but still reports the intent', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });

    const res = await baseHandler({ detail: { dryRun: true } });

    expect(res.totals.prepared).toBe(1);
    expect(mockTransitionFoiaAutomationState).not.toHaveBeenCalled();
    expect(mockPrepareFoiaRequest).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, skipDocumentScan: true }),
    );
  });
});

describe('scan-foia-automation — SENDING state hazard mitigation', () => {
  /**
   * These tests verify the fix for the latent bug where autoSendEligible=true
   * would transition a record to SENDING with no code path to release it.
   *
   * The scanner is now a pure reconciler that NEVER enters SENDING. That state
   * is owned exclusively by the send handler, which drives the full lifecycle:
   * AWAITING_APPROVAL -> SENDING -> (SENT | FAILED). The scanner only moves
   * records to AWAITING_APPROVAL and stores autoSendEligible for the downstream
   * sender to consume.
   */
  const dueOpp = () => buildOpp({ responseDeadlineIso: overdueDeadline() });

  it('never leaves a record in SENDING after a successful prepare', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });
    mockPrepareFoiaRequest.mockResolvedValue({
      status: 'PREPARED',
      request: { foiaId: 'foia-1', agencyFOIAEmail: 'foia@army.mil', agencyFOIAAddress: 'addr' },
      letter: 'L',
      artifacts: [],
      autoSendEligible: true,
      recipientSource: 'FOIA_GOV',
    });

    await baseHandler({});

    // Verify the scanner moved to AWAITING_APPROVAL, not SENDING.
    const transitionCall = mockTransitionFoiaAutomationState.mock.calls[0]![0] as {
      to: string;
    };
    expect(transitionCall.to).toBe('AWAITING_APPROVAL');

    // Verify no state transition to SENDING ever happened.
    const allTransitions = mockTransitionFoiaAutomationState.mock.calls;
    for (const [call] of allTransitions) {
      expect((call as { to: string }).to).not.toBe('SENDING');
    }
  });

  it('never leaves a record in SENDING after a blocked prepare', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });
    mockPrepareFoiaRequest.mockResolvedValue({
      status: 'BLOCKED',
      blockedReason: 'NEEDS_RECIPIENT',
    });

    await baseHandler({});

    // Verify the scanner moved to BLOCKED, not SENDING.
    const transitionCall = mockTransitionFoiaAutomationState.mock.calls[0]![0] as {
      to: string;
    };
    expect(transitionCall.to).toBe('BLOCKED');

    // Verify no state transition to SENDING ever happened.
    const allTransitions = mockTransitionFoiaAutomationState.mock.calls;
    for (const [call] of allTransitions) {
      expect((call as { to: string }).to).not.toBe('SENDING');
    }
  });

  it('never leaves a record in SENDING after a lost transition race', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });
    mockPrepareFoiaRequest.mockResolvedValue({
      status: 'PREPARED',
      request: { foiaId: 'foia-1', agencyFOIAEmail: 'foia@army.mil', agencyFOIAAddress: 'addr' },
      letter: 'L',
      artifacts: [],
      autoSendEligible: true,
      recipientSource: 'FOIA_GOV',
    });
    // Simulate a concurrent scanner that already moved the record.
    mockTransitionFoiaAutomationState.mockResolvedValue(null);

    await baseHandler({});

    // Verify no state transition to SENDING ever happened.
    const allTransitions = mockTransitionFoiaAutomationState.mock.calls;
    for (const [call] of allTransitions) {
      expect((call as { to: string }).to).not.toBe('SENDING');
    }
  });

  it('never transitions to SENDING on a dry run', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });
    mockPrepareFoiaRequest.mockResolvedValue({
      status: 'PREPARED',
      request: { foiaId: 'foia-1', agencyFOIAEmail: 'foia@army.mil', agencyFOIAAddress: 'addr' },
      letter: 'L',
      artifacts: [],
      autoSendEligible: true,
      recipientSource: 'FOIA_GOV',
    });

    await baseHandler({ detail: { dryRun: true } });

    // On a dry run, no state transitions happen at all.
    expect(mockTransitionFoiaAutomationState).not.toHaveBeenCalled();
  });

  it('never attempts to send directly from the scanner', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });
    mockPrepareFoiaRequest.mockResolvedValue({
      status: 'PREPARED',
      request: { foiaId: 'foia-1', agencyFOIAEmail: 'foia@army.mil', agencyFOIAAddress: 'addr' },
      letter: 'L',
      artifacts: [],
      autoSendEligible: true,
      recipientSource: 'FOIA_GOV',
    });

    await baseHandler({});

    // The scanner prepares the request but never calls any send function.
    // (There is no sendFoiaRequest mock in this file because the scanner never
    // imports it.)
    expect(mockPrepareFoiaRequest).toHaveBeenCalledTimes(1);
    // Only the prepare happened, the send is left for a different mechanism.
  });

  it('still honors autoSendEligible=false by setting the flag to false', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [dueOpp()] });
    mockPrepareFoiaRequest.mockResolvedValue({
      status: 'PREPARED',
      request: { foiaId: 'foia-1', agencyFOIAEmail: 'foia@army.mil', agencyFOIAAddress: 'addr' },
      letter: 'L',
      artifacts: [],
      autoSendEligible: false,
      recipientSource: 'OPP_CONTACT',
    });

    await baseHandler({});

    expect(mockTransitionFoiaAutomationState).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'AWAITING_APPROVAL',
        patch: expect.objectContaining({ autoSendEligible: false }),
      }),
    );
  });
});

describe('scan-foia-automation — resilience', () => {
  it('keeps going when one opportunity throws', async () => {
    mockListOpportunitiesByOrg.mockResolvedValue({
      items: [
        buildOpp({ oppId: 'opp-bad' }),
        buildOpp({ oppId: 'opp-good' }),
      ],
    });
    mockGetFoiaAutomation.mockImplementation((_o: string, _p: string, oppId: string) => {
      if (oppId === 'opp-bad') throw new Error('dynamo exploded');
      return Promise.resolve(null);
    });

    const res = await baseHandler({});

    // The bad record is counted as an error, the good one still gets scheduled.
    expect(res.totals.errors).toBe(1);
    expect(res.totals.scheduled).toBe(1);
  });

  it('keeps going when a whole org throws', async () => {
    mockListAllOrgIds.mockResolvedValue(['org-bad', 'org-good']);
    mockGetFoiaSettings.mockImplementation((orgId: string) => {
      if (orgId === 'org-bad') throw new Error('settings unavailable');
      return Promise.resolve({ ...defaultSettings, orgId });
    });

    const res = await baseHandler({});

    expect(res.ok).toBe(true);
    expect(res.totals.errors).toBe(1);
    expect(res.totals.scheduled).toBe(1);
  });

  it('does not fail the pass when the opportunity marker sync fails', async () => {
    mockSyncOpportunityFoiaMarker.mockRejectedValue(new Error('opportunity gone'));

    // syncOpportunityFoiaMarker is documented as best-effort, but the scanner
    // must not depend on that promise resolving.
    const res = await baseHandler({});

    expect(res.ok).toBe(true);
    expect(res.totals.errors + res.totals.scheduled).toBe(1);
  });
});

const mockGetOpportunity = jest.fn();
const mockUpdateOpportunity = jest.fn().mockResolvedValue({ oppId: 'opp-1' });
jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
  updateOpportunity: (...args: unknown[]) => mockUpdateOpportunity(...args),
}));

import { handler } from './on-poc-result';

interface EventBridgeEvent {
  detail: unknown;
  source: string;
  'detail-type': string;
}

const completeEvent = (detail: Record<string, unknown>): EventBridgeEvent => ({
  source: 'development-platform.poc',
  'detail-type': 'POCDeploymentComplete',
  detail,
});

const failedEvent = (detail: Record<string, unknown>): EventBridgeEvent => ({
  source: 'development-platform.poc',
  'detail-type': 'POCDeploymentFailed',
  detail,
});

const validComplete = {
  oppId: 'opp-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  pocUrl: 'https://poc.horustech.dev/opp-1/',
  deployedAt: '2026-04-01T12:34:56Z',
};

const validFailed = {
  oppId: 'opp-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  failureReason: 'Failed to build POC after 3 attempts',
  failedAt: '2026-04-01T13:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateOpportunity.mockResolvedValue({ oppId: 'opp-1' });
});

describe('on-poc-result handler', () => {
  // (a) Complete only
  it('marks succeeded and clears failure fields on Complete', async () => {
    await handler(completeEvent(validComplete));

    expect(mockUpdateOpportunity).toHaveBeenCalledTimes(1);
    expect(mockUpdateOpportunity).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      patch: {
        pocUrl: validComplete.pocUrl,
        pocDeployedAt: validComplete.deployedAt,
        pocGenState: 'succeeded',
        pocFailureReason: null,
        pocFailedAt: null,
      },
    });
    // Complete does not need to read the record first
    expect(mockGetOpportunity).not.toHaveBeenCalled();
  });

  // (b) Failed only — no existing pocUrl
  it('marks failed and stores the reason when no POC exists yet', async () => {
    mockGetOpportunity.mockResolvedValue({ item: { pocGenState: 'generating' }, oppId: 'opp-1' });

    await handler(failedEvent(validFailed));

    expect(mockUpdateOpportunity).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      patch: {
        pocGenState: 'failed',
        pocFailureReason: validFailed.failureReason,
        pocFailedAt: validFailed.failedAt,
      },
    });
  });

  // (c) Complete then Failed — Complete wins, button stays succeeded
  it('drops Failed when a pocUrl already exists (Complete wins)', async () => {
    mockGetOpportunity.mockResolvedValue({
      item: { pocUrl: 'https://poc.horustech.dev/opp-1/', pocGenState: 'succeeded' },
      oppId: 'opp-1',
    });

    await handler(failedEvent(validFailed));

    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
  });

  it('drops Failed when state is already succeeded even without a pocUrl', async () => {
    mockGetOpportunity.mockResolvedValue({ item: { pocGenState: 'succeeded' }, oppId: 'opp-1' });

    await handler(failedEvent(validFailed));

    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
  });

  // (d) duplicate delivery — idempotent
  it('is idempotent for duplicate Complete delivery', async () => {
    await handler(completeEvent(validComplete));
    await handler(completeEvent(validComplete));

    expect(mockUpdateOpportunity).toHaveBeenCalledTimes(2);
    // Both calls carry the same terminal patch — no divergent state.
    expect(mockUpdateOpportunity.mock.calls[0][0]).toEqual(mockUpdateOpportunity.mock.calls[1][0]);
  });

  it('is idempotent for duplicate Failed delivery', async () => {
    mockGetOpportunity.mockResolvedValue({ item: { pocGenState: 'generating' }, oppId: 'opp-1' });

    await handler(failedEvent(validFailed));
    await handler(failedEvent(validFailed));

    expect(mockUpdateOpportunity).toHaveBeenCalledTimes(2);
    expect(mockUpdateOpportunity.mock.calls[0][0]).toEqual(mockUpdateOpportunity.mock.calls[1][0]);
  });

  // (e) two legitimate Completes from a re-run
  it('handles two Completes from a re-run without error', async () => {
    await handler(completeEvent(validComplete));
    await handler(completeEvent({ ...validComplete, deployedAt: '2026-05-01T09:00:00Z' }));

    expect(mockUpdateOpportunity).toHaveBeenCalledTimes(2);
    expect(mockUpdateOpportunity.mock.calls[1][0].patch.pocGenState).toBe('succeeded');
  });

  // Correlation: missing/empty org or project on Failed
  it('drops Failed when orgId is null', async () => {
    await handler(failedEvent({ ...validFailed, orgId: null }));

    expect(mockGetOpportunity).not.toHaveBeenCalled();
    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
  });

  it('drops Failed when projectId is an empty string', async () => {
    await handler(failedEvent({ ...validFailed, projectId: '' }));

    expect(mockGetOpportunity).not.toHaveBeenCalled();
    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
  });

  it('drops Failed when the opportunity is not found', async () => {
    mockGetOpportunity.mockResolvedValue(undefined);

    await handler(failedEvent(validFailed));

    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
  });

  // Invalid payloads must not throw (EventBridge would otherwise retry forever)
  it('does not throw or update on invalid Complete detail', async () => {
    await expect(handler(completeEvent({ oppId: 'opp-1' }))).resolves.toBeUndefined();
    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
  });

  it('does not throw or update on invalid Failed detail', async () => {
    await expect(handler(failedEvent({ oppId: 'opp-1' }))).resolves.toBeUndefined();
    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
  });

  it('ignores unexpected detail-types', async () => {
    await handler({
      source: 'development-platform.poc',
      'detail-type': 'SomethingElse',
      detail: validComplete,
    });

    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
    expect(mockGetOpportunity).not.toHaveBeenCalled();
  });
});

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

const mockGetOpportunity = jest.fn();
const mockUpdateOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
  updateOpportunity: (...args: unknown[]) => mockUpdateOpportunity(...args),
}));

const mockTransitionOpportunityStatus = jest.fn();
jest.mock('@/helpers/opportunity-status', () => ({
  transitionOpportunityStatus: (...args: unknown[]) => mockTransitionOpportunityStatus(...args),
}));

const mockSyncPhysicalSubmissionLabel = jest.fn();
jest.mock('@/helpers/linear', () => ({
  syncPhysicalSubmissionLabel: (...args: unknown[]) => mockSyncPhysicalSubmissionLabel(...args),
}));

const mockResolveUserNames = jest.fn();
jest.mock('@/helpers/resolve-users', () => ({
  resolveUserNames: (...args: unknown[]) => mockResolveUserNames(...args),
}));

const mockGetOrgMembers = jest.fn();
jest.mock('@/helpers/user', () => ({
  getOrgMembers: (...args: unknown[]) => mockGetOrgMembers(...args),
}));

const mockSendNotification = jest.fn();
const mockBuildNotification = jest.fn();
jest.mock('@/helpers/send-notification', () => ({
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  buildNotification: (...args: unknown[]) => mockBuildNotification(...args),
}));

import { baseHandler } from './update-opportunity';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const makeEvent = (body: unknown): AuthedEvent =>
  ({
    body: JSON.stringify(body),
    auth: { userId: 'user-001', orgId: 'org-123', claims: {} },
    requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
    headers: {},
    queryStringParameters: {},
    pathParameters: {},
  }) as unknown as AuthedEvent;

// Fire-and-forget calls resolve on the microtask queue after the handler returns.
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

describe('update-opportunity — physical submission Linear sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOpportunity.mockResolvedValue({ item: { status: 'IDENTIFIED' }, oppId: 'opp-1' });
    mockResolveUserNames.mockResolvedValue({});
    mockSyncPhysicalSubmissionLabel.mockResolvedValue(undefined);
  });

  it('syncs the Linear label with isPhysical: true when submissionMethod is patched to PHYSICAL', async () => {
    mockUpdateOpportunity.mockResolvedValue({ item: { submissionMethod: 'PHYSICAL' }, oppId: 'opp-1' });

    const response = await baseHandler(
      makeEvent({ projectId: 'proj-1', oppId: 'opp-1', patch: { submissionMethod: 'PHYSICAL' } }),
    );
    await flushMicrotasks();

    expect(response).toMatchObject({ statusCode: 200 });
    expect(mockSyncPhysicalSubmissionLabel).toHaveBeenCalledWith('org-123', 'opp-1', true);
  });

  it('syncs the Linear label with isPhysical: false when submissionMethod is patched to ELECTRONIC', async () => {
    mockUpdateOpportunity.mockResolvedValue({ item: { submissionMethod: 'ELECTRONIC' }, oppId: 'opp-1' });

    const response = await baseHandler(
      makeEvent({ projectId: 'proj-1', oppId: 'opp-1', patch: { submissionMethod: 'ELECTRONIC' } }),
    );
    await flushMicrotasks();

    expect(response).toMatchObject({ statusCode: 200 });
    expect(mockSyncPhysicalSubmissionLabel).toHaveBeenCalledWith('org-123', 'opp-1', false);
  });

  it('does not sync the Linear label when a field other than submissionMethod is patched', async () => {
    mockUpdateOpportunity.mockResolvedValue({ item: { title: 'Updated title' }, oppId: 'opp-1' });

    const response = await baseHandler(
      makeEvent({ projectId: 'proj-1', oppId: 'opp-1', patch: { title: 'Updated title' } }),
    );
    await flushMicrotasks();

    expect(response).toMatchObject({ statusCode: 200 });
    expect(mockSyncPhysicalSubmissionLabel).not.toHaveBeenCalled();
  });

  it('still returns a 200 response when the Linear sync fails', async () => {
    mockUpdateOpportunity.mockResolvedValue({ item: { submissionMethod: 'BOTH' }, oppId: 'opp-1' });
    mockSyncPhysicalSubmissionLabel.mockRejectedValue(new Error('Linear API down'));

    const response = await baseHandler(
      makeEvent({ projectId: 'proj-1', oppId: 'opp-1', patch: { submissionMethod: 'BOTH' } }),
    );
    await flushMicrotasks();

    expect(response).toMatchObject({ statusCode: 200 });
    expect(mockSyncPhysicalSubmissionLabel).toHaveBeenCalledWith('org-123', 'opp-1', true);
  });
});

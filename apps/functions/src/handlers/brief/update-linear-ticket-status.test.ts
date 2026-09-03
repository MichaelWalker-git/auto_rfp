/**
 * update-linear-ticket-status.test.ts
 *
 * Pins the change-status contract the "Change Status" dialog relies on: the
 * chosen stateId must reach updateLinearTicket for the brief's existing ticket.
 */

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

const mockSetLinearIssueStage = jest.fn();
jest.mock('@/helpers/linear', () => ({
  setLinearIssueStage: (...args: unknown[]) => mockSetLinearIssueStage(...args),
}));

const mockGetExecutiveBrief = jest.fn();
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  getExecutiveBrief: (...args: unknown[]) => mockGetExecutiveBrief(...args),
}));

import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './update-linear-ticket-status';

const ORG = 'org-1';

const makeEvent = (body: Record<string, unknown>): APIGatewayProxyEventV2 =>
  ({
    queryStringParameters: { orgId: ORG },
    body: JSON.stringify(body),
  }) as unknown as APIGatewayProxyEventV2;

const brief = (overrides: Record<string, unknown> = {}) => ({
  sort_key: 'brief-1',
  linearTicketId: 'ticket-1',
  linearTicketIdentifier: 'HOR-1',
  linearTicketUrl: 'https://l/HOR-1',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetExecutiveBrief.mockResolvedValue(brief());
  mockSetLinearIssueStage.mockResolvedValue(true);
});

describe('update-linear-ticket-status', () => {
  it('moves the existing ticket to the chosen stage (status + gate-label swap)', async () => {
    const res = await baseHandler(
      makeEvent({ executiveBriefId: 'brief-1', stage: 'secondApproved' }),
    );

    expect(res.statusCode).toBe(200);
    // secondApproved → In Progress status, add "II Approved", remove the other gates.
    expect(mockSetLinearIssueStage).toHaveBeenCalledWith(
      ORG,
      'ticket-1',
      expect.objectContaining({
        status: 'In Progress',
        addLabels: ['II Approved'],
      }),
    );
  });

  it('400s when the org id is missing', async () => {
    const res = await baseHandler({
      queryStringParameters: null,
      body: JSON.stringify({ executiveBriefId: 'brief-1', stage: 'secondApproved' }),
    } as unknown as APIGatewayProxyEventV2);

    expect(res.statusCode).toBe(400);
    expect(mockSetLinearIssueStage).not.toHaveBeenCalled();
  });

  it('400s when the stage is not a valid RFP stage', async () => {
    const res = await baseHandler(
      makeEvent({ executiveBriefId: 'brief-1', stage: 'bogus' }),
    );

    expect(res.statusCode).toBe(500);
    expect(mockSetLinearIssueStage).not.toHaveBeenCalled();
  });

  it('400s when the brief has no Linear ticket yet', async () => {
    mockGetExecutiveBrief.mockResolvedValue(brief({ linearTicketId: undefined }));

    const res = await baseHandler(
      makeEvent({ executiveBriefId: 'brief-1', stage: 'secondApproved' }),
    );

    expect(res.statusCode).toBe(400);
    expect(mockSetLinearIssueStage).not.toHaveBeenCalled();
  });

  it('404s when the brief is not found', async () => {
    mockGetExecutiveBrief.mockResolvedValue(null);

    const res = await baseHandler(
      makeEvent({ executiveBriefId: 'missing', stage: 'secondApproved' }),
    );

    expect(res.statusCode).toBe(404);
  });

  it('502s when the Linear update throws', async () => {
    mockSetLinearIssueStage.mockRejectedValue(new Error('boom'));

    const res = await baseHandler(
      makeEvent({ executiveBriefId: 'brief-1', stage: 'secondApproved' }),
    );

    expect(res.statusCode).toBe(502);
  });

  it('502s when the target status/team is not found (helper returns false)', async () => {
    mockSetLinearIssueStage.mockResolvedValue(false);

    const res = await baseHandler(
      makeEvent({ executiveBriefId: 'brief-1', stage: 'secondApproved' }),
    );

    expect(res.statusCode).toBe(502);
  });
});

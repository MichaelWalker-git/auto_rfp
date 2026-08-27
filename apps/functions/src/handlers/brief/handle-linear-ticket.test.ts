/**
 * Tests for the handle-linear-ticket handler (HOR-2729).
 *
 * The ticket body is a preliminary-offer hand-off note, not an RFP breakdown.
 * At creation only the AutoRFP deep-link is known (Analysis/Documents links are
 * filled in later by the Drive worker). These tests assert the offer-note shape
 * and the AutoRFP link, built from APP_URL and the brief's path segments.
 */
jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));

const mockCreateLinearTicket = jest.fn();
const mockUpdateLinearTicket = jest.fn();
jest.mock('@/helpers/linear', () => ({
  createLinearTicket: (...a: unknown[]) => mockCreateLinearTicket(...a),
  updateLinearTicket: (...a: unknown[]) => mockUpdateLinearTicket(...a),
}));

const mockGetExecutiveBrief = jest.fn();
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  getExecutiveBrief: (...a: unknown[]) => mockGetExecutiveBrief(...a),
}));

const mockGetProjectById = jest.fn();
jest.mock('@/helpers/project', () => ({
  getProjectById: (...a: unknown[]) => mockGetProjectById(...a),
}));

const mockSend = jest.fn();
jest.mock('@/helpers/db', () => ({
  docClient: { send: (...a: unknown[]) => mockSend(...a) },
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.APP_URL = 'https://app.test.example';

import { baseHandler } from './handle-linear-ticket';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const makeEvent = (body: unknown, orgId?: string): APIGatewayProxyEventV2 =>
  ({
    body: JSON.stringify(body),
    auth: { userId: 'user-1', ...(orgId ? { orgId } : {}), claims: {} },
    headers: {},
    queryStringParameters: {},
    requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
  }) as unknown as APIGatewayProxyEventV2;

const briefFixture = {
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  sections: {
    summary: { data: { agency: 'DoD', title: 'Widget RFP', summary: 'A summary.' } },
    scoring: { data: { decision: 'GO' } },
  },
};

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): any => JSON.parse((res as { body: string }).body);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetExecutiveBrief.mockResolvedValue(briefFixture);
  mockGetProjectById.mockResolvedValue({ id: 'proj-1', name: 'Project One' });
  mockCreateLinearTicket.mockResolvedValue({ id: 'lin-1', identifier: 'ENG-1', url: 'https://linear.app/x/ENG-1' });
  mockSend.mockResolvedValue({});
});

describe('handle-linear-ticket — offer hand-off note (HOR-2729 §1)', () => {
  it('creates an offer-note body with the AutoRFP opportunity URL', async () => {
    const res = await baseHandler(makeEvent({ executiveBriefId: 'brief-1' }, 'org-1'));

    expect(statusOf(res)).toBe(200);
    expect(mockCreateLinearTicket).toHaveBeenCalledTimes(1);

    const { description } = mockCreateLinearTicket.mock.calls[0][0];
    // Offer hand-off note — greeting + preamble, not an RFP breakdown.
    expect(description).toContain('Hi Brennen,');
    expect(description).toContain("I've prepared a preliminary offer");
    expect(description).not.toContain('# RFP Opportunity');
    // AutoRFP link present at creation; Analysis/Documents links fill in later.
    expect(description).toContain(
      'AutoRFP: https://app.test.example/organizations/org-1/projects/proj-1/opportunities/opp-1',
    );
    expect(description).not.toContain('Analysis:');
    expect(description).not.toContain('Documents:');
  });

  it('returns 400 when no orgId can be resolved', async () => {
    const res = await baseHandler(makeEvent({ executiveBriefId: 'brief-1' }));

    expect(statusOf(res)).toBe(400);
    expect(mockCreateLinearTicket).not.toHaveBeenCalled();
  });

  it('returns 404 when the executive brief is missing', async () => {
    mockGetExecutiveBrief.mockResolvedValue(null);

    const res = await baseHandler(makeEvent({ executiveBriefId: 'brief-1' }, 'org-1'));

    expect(statusOf(res)).toBe(404);
    expect(mockCreateLinearTicket).not.toHaveBeenCalled();
  });

  it('does not create a new ticket when one already exists (updates instead)', async () => {
    mockGetExecutiveBrief.mockResolvedValue({ ...briefFixture, linearTicketId: 'lin-existing' });
    mockUpdateLinearTicket.mockResolvedValue({});

    const res = await baseHandler(makeEvent({ executiveBriefId: 'brief-1' }, 'org-1'));

    expect(statusOf(res)).toBe(200);
    expect(mockUpdateLinearTicket).toHaveBeenCalledTimes(1);
    expect(mockCreateLinearTicket).not.toHaveBeenCalled();
  });

  it('omits the AutoRFP link when path segments are missing', async () => {
    mockGetExecutiveBrief.mockResolvedValue({ ...briefFixture, opportunityId: undefined });

    const res = await baseHandler(makeEvent({ executiveBriefId: 'brief-1' }, 'org-1'));

    expect(statusOf(res)).toBe(200);
    const { description } = mockCreateLinearTicket.mock.calls[0][0];
    // No opportunity segments → no AutoRFP line, but the offer greeting still renders.
    expect(description).toContain('Hi Brennen,');
    expect(description).not.toContain('AutoRFP:');
  });
});

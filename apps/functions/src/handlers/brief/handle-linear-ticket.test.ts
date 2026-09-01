/**
 * handle-linear-ticket.test.ts
 *
 * Pins the create-ticket contract the "Create Linear Ticket" dialog relies on:
 * the chosen assignee, status, and due date must reach createLinearTicket.
 */

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('@/helpers/env', () => ({
  requireEnv: jest.fn(() => 'test-table'),
}));

const mockCreateLinearTicket = jest.fn();
const mockUpdateLinearTicket = jest.fn();
jest.mock('@/helpers/linear', () => ({
  createLinearTicket: (...args: unknown[]) => mockCreateLinearTicket(...args),
  updateLinearTicket: (...args: unknown[]) => mockUpdateLinearTicket(...args),
}));

const mockGetExecutiveBrief = jest.fn();
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  getExecutiveBrief: (...args: unknown[]) => mockGetExecutiveBrief(...args),
}));

const mockGetProjectById = jest.fn();
jest.mock('@/helpers/project', () => ({
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
}));

const mockSend = jest.fn();
jest.mock('@/helpers/db', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './handle-linear-ticket';

const ORG = 'org-1';

const makeEvent = (body: Record<string, unknown>): APIGatewayProxyEventV2 =>
  ({
    queryStringParameters: { orgId: ORG },
    body: JSON.stringify(body),
  }) as unknown as APIGatewayProxyEventV2;

const brief = (overrides: Record<string, unknown> = {}) => ({
  sort_key: 'brief-1',
  projectId: 'proj-1',
  googleDriveFolderUrl: 'https://drive.google.com/drive/folders/abc',
  googleDriveBriefDocUrl: 'https://docs.google.com/document/d/xyz',
  sections: {
    summary: { data: { title: 'Widget RFP' } },
    deadlines: { data: { submissionDeadlineIso: '2026-10-01' } },
    scoring: { data: { decision: 'GO' } },
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetExecutiveBrief.mockResolvedValue(brief());
  mockGetProjectById.mockResolvedValue({ name: 'Project One' });
  mockCreateLinearTicket.mockResolvedValue({ id: 't1', identifier: 'HOR-1', url: 'https://l/HOR-1' });
  mockSend.mockResolvedValue({});
});

describe('handle-linear-ticket — create', () => {
  it('threads assigneeId, stateId, and dueDate into createLinearTicket', async () => {
    const res = await baseHandler(
      makeEvent({
        executiveBriefId: 'brief-1',
        appUrl: 'https://rfp.example.com/opp',
        assigneeId: 'user-9',
        stateId: 'state-3',
        dueDate: '2026-12-15',
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(mockCreateLinearTicket).toHaveBeenCalledTimes(1);
    expect(mockCreateLinearTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG,
        assigneeId: 'user-9',
        stateId: 'state-3',
        dueDate: '2026-12-15',
      }),
    );
  });

  it('falls back to the brief submission deadline when dueDate is omitted', async () => {
    await baseHandler(
      makeEvent({
        executiveBriefId: 'brief-1',
        appUrl: 'https://rfp.example.com/opp',
        assigneeId: 'user-9',
        stateId: 'state-3',
      }),
    );

    expect(mockCreateLinearTicket).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: '2026-10-01' }),
    );
  });

  it('400s when the Drive folder has not been created yet', async () => {
    mockGetExecutiveBrief.mockResolvedValue(brief({ googleDriveFolderUrl: undefined }));

    const res = await baseHandler(
      makeEvent({ executiveBriefId: 'brief-1', appUrl: 'https://rfp.example.com/opp' }),
    );

    expect(res.statusCode).toBe(400);
    expect(mockCreateLinearTicket).not.toHaveBeenCalled();
  });

  it('502s when ticket creation fails (returns null)', async () => {
    mockCreateLinearTicket.mockResolvedValue(null);

    const res = await baseHandler(
      makeEvent({
        executiveBriefId: 'brief-1',
        appUrl: 'https://rfp.example.com/opp',
        assigneeId: 'user-9',
        stateId: 'state-3',
        dueDate: '2026-12-15',
      }),
    );

    expect(res.statusCode).toBe(502);
  });
});

/**
 * Tests for the per-section exec-brief enqueue helper — focused on the
 * Solution Plan staleness trigger (T13): regenerating a single section marks a
 * READY plan stale (best-effort, via markSolutionPlanStaleSafe) without ever
 * failing the enqueue, and never fires when the enqueue itself fails.
 */
jest.mock('@/helpers/env', () => ({
  requireEnv: (key: string) => `test-${key}`,
}));

const mockSqsSend = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(() => ({ send: (...a: unknown[]) => mockSqsSend(...a) })),
  SendMessageCommand: jest.fn((params) => ({ type: 'SendMessage', params })),
}));

const mockGetBrief = jest.fn();
const mockMarkSectionInProgress = jest.fn();
const mockMarkSectionFailed = jest.fn();
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  buildSectionInputHash: jest.fn(() => 'hash-1'),
  getExecutiveBrief: (...a: unknown[]) => mockGetBrief(...a),
  markSectionInProgress: (...a: unknown[]) => mockMarkSectionInProgress(...a),
  markSectionFailed: (...a: unknown[]) => mockMarkSectionFailed(...a),
}));

const mockMarkStaleSafe = jest.fn();
jest.mock('@/helpers/solution-plan', () => ({
  ...(jest.requireActual('@/helpers/solution-plan') as object),
  markSolutionPlanStaleSafe: (...a: unknown[]) => mockMarkStaleSafe(...a),
}));

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { enqueueExecutiveBriefSection, makeEnqueueHandler } from './executive-brief-queue';

const makeEvent = (orgId?: string): APIGatewayProxyEventV2 =>
  ({
    body: JSON.stringify({ executiveBriefId: 'proj-1#opp-1' }),
    headers: {},
    queryStringParameters: orgId ? { orgId } : {},
    requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
  }) as unknown as APIGatewayProxyEventV2;

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetBrief.mockResolvedValue({
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    allTextKeys: ['text/qf-1.txt'],
  });
  mockMarkSectionInProgress.mockResolvedValue(undefined);
  mockMarkSectionFailed.mockResolvedValue(undefined);
  mockSqsSend.mockResolvedValue({});
  mockMarkStaleSafe.mockResolvedValue(null);
});

describe('enqueueExecutiveBriefSection — solution plan staleness trigger (T13)', () => {
  it('marks the plan stale with a section-regenerated reason after a successful enqueue', async () => {
    const res = await enqueueExecutiveBriefSection(makeEvent('org-1'), 'risks');

    expect(statusOf(res)).toBe(202);
    expect(mockSqsSend).toHaveBeenCalledTimes(1);
    expect(mockMarkStaleSafe).toHaveBeenCalledWith(
      { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' },
      'The Executive Brief\'s "risks" section is being regenerated.',
    );
  });

  it('returns 401 and skips the trigger when no orgId can be resolved', async () => {
    const res = await enqueueExecutiveBriefSection(makeEvent(), 'risks');

    expect(statusOf(res)).toBe(401);
    expect(mockSqsSend).not.toHaveBeenCalled();
    expect(mockMarkStaleSafe).not.toHaveBeenCalled();
  });

  it('does not trigger when the SQS enqueue fails', async () => {
    mockSqsSend.mockRejectedValue(new Error('SQS down'));

    const res = await enqueueExecutiveBriefSection(makeEvent('org-1'), 'summary');

    expect(statusOf(res)).toBe(500);
    expect(mockMarkSectionFailed).toHaveBeenCalled();
    expect(mockMarkStaleSafe).not.toHaveBeenCalled();
  });

  it('does not trigger when marking the section in progress fails', async () => {
    mockMarkSectionInProgress.mockRejectedValue(new Error('DynamoDB down'));

    const res = await enqueueExecutiveBriefSection(makeEvent('org-1'), 'summary');

    expect(statusOf(res)).toBe(500);
    expect(mockMarkStaleSafe).not.toHaveBeenCalled();
  });

  it('still returns 202 when the plan is missing or not READY (safe helper resolves null)', async () => {
    mockMarkStaleSafe.mockResolvedValue(null);

    const res = await enqueueExecutiveBriefSection(makeEvent('org-1'), 'pricing');

    expect(statusOf(res)).toBe(202);
  });

  it('wires the section through makeEnqueueHandler', async () => {
    const res = await makeEnqueueHandler('summary')(makeEvent('org-1'));

    expect(statusOf(res)).toBe(202);
    expect(mockMarkStaleSafe).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1' }),
      'The Executive Brief\'s "summary" section is being regenerated.',
    );
  });
});

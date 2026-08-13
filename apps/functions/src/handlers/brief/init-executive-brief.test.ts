/**
 * Tests for the init-executive-brief handler — focused on the Solution Plan
 * staleness trigger (T13): a brief (re)generation marks a READY plan stale
 * (best-effort, via markSolutionPlanStaleSafe) without ever failing the init.
 */
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));
const mockSetAuditContext = jest.fn();
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: () => ({}),
  setAuditContext: (...a: unknown[]) => mockSetAuditContext(...a),
}));

const mockGetBrief = jest.fn();
const mockPutBrief = jest.fn();
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  executiveBriefSKByOpportunity: (projectId: string, opportunityId: string) =>
    `${projectId}#${opportunityId}`,
  getExecutiveBriefByProjectId: (...a: unknown[]) => mockGetBrief(...a),
  putExecutiveBrief: (...a: unknown[]) => mockPutBrief(...a),
}));

const mockListQuestionFiles = jest.fn();
jest.mock('@/helpers/questionFile', () => ({
  isExtractedQuestionFile: (status: string) => status === 'PROCESSED',
  listQuestionFilesByOpportunity: (...a: unknown[]) => mockListQuestionFiles(...a),
}));

const mockOnBriefGenerationStarted = jest.fn();
jest.mock('@/helpers/opportunity-status', () => ({
  onBriefGenerationStarted: (...a: unknown[]) => mockOnBriefGenerationStarted(...a),
}));

const mockMarkStaleSafe = jest.fn();
jest.mock('@/helpers/solution-plan', () => ({
  ...(jest.requireActual('@/helpers/solution-plan') as object),
  markSolutionPlanStaleSafe: (...a: unknown[]) => mockMarkStaleSafe(...a),
}));

import { initExecutiveBrief } from './init-executive-brief';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const processedFile = {
  questionFileId: 'qf-1',
  status: 'PROCESSED',
  textFileKey: 'text/qf-1.txt',
  createdAt: '2026-08-13T00:00:00.000Z',
};

const makeEvent = (body: unknown, orgId?: string): AuthedEvent =>
  ({
    body: JSON.stringify(body),
    auth: { userId: 'user-1', ...(orgId ? { orgId } : {}), claims: {} },
    headers: {},
    queryStringParameters: {},
    requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
  }) as unknown as AuthedEvent;

const validBody = { projectId: 'proj-1', opportunityId: 'opp-1' };

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;

beforeEach(() => {
  jest.clearAllMocks();
  mockListQuestionFiles.mockResolvedValue({ items: [processedFile] });
  mockGetBrief.mockResolvedValue(null);
  mockPutBrief.mockResolvedValue({});
  mockMarkStaleSafe.mockResolvedValue(null);
});

describe('init-executive-brief — solution plan staleness trigger (T13)', () => {
  it('marks the plan stale with a "generated" reason on first-time brief generation', async () => {
    const res = await initExecutiveBrief(makeEvent(validBody, 'org-1'));

    expect(statusOf(res)).toBe(200);
    expect(mockMarkStaleSafe).toHaveBeenCalledWith(
      { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' },
      'An Executive Brief is being generated.',
    );
  });

  it('marks the plan stale with a "regenerated" reason when a brief already exists', async () => {
    mockGetBrief.mockResolvedValue({
      partition_key: 'EXEC_BRIEF',
      sort_key: 'proj-1#opp-1',
      createdAt: '2026-08-01T00:00:00.000Z',
    });

    const res = await initExecutiveBrief(makeEvent(validBody, 'org-1'));

    expect(statusOf(res)).toBe(200);
    expect(mockMarkStaleSafe).toHaveBeenCalledWith(
      { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' },
      'The Executive Brief is being regenerated.',
    );
  });

  it('skips the trigger when no orgId can be resolved (plan SK needs the org)', async () => {
    const res = await initExecutiveBrief(makeEvent(validBody));

    expect(statusOf(res)).toBe(200);
    expect(mockMarkStaleSafe).not.toHaveBeenCalled();
  });

  it('does not trigger when validation fails', async () => {
    const res = await initExecutiveBrief(makeEvent({ projectId: 'proj-1' }, 'org-1'));

    expect(statusOf(res)).toBe(400);
    expect(mockMarkStaleSafe).not.toHaveBeenCalled();
  });

  it('does not trigger when no processed question files exist (brief init refused)', async () => {
    mockListQuestionFiles.mockResolvedValue({ items: [] });

    const res = await initExecutiveBrief(makeEvent(validBody, 'org-1'));

    expect(statusOf(res)).toBe(400);
    expect(mockMarkStaleSafe).not.toHaveBeenCalled();
    expect(mockPutBrief).not.toHaveBeenCalled();
  });

  it('still succeeds when the plan is missing or not READY (safe helper resolves null)', async () => {
    mockMarkStaleSafe.mockResolvedValue(null);

    const res = await initExecutiveBrief(makeEvent(validBody, 'org-1'));

    expect(statusOf(res)).toBe(200);
    expect(mockPutBrief).toHaveBeenCalledTimes(1);
  });
});

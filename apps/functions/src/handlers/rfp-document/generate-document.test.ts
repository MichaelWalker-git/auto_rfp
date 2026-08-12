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
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: () => ({}),
  setAuditContext: jest.fn(),
}));

const mockGetProjectById = jest.fn();
jest.mock('@/helpers/project', () => ({
  getProjectById: (...a: unknown[]) => mockGetProjectById(...a),
}));

const mockPutRFPDocument = jest.fn();
const mockUpdateMetadata = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  putRFPDocument: (...a: unknown[]) => mockPutRFPDocument(...a),
  updateRFPDocumentMetadata: (...a: unknown[]) => mockUpdateMetadata(...a),
}));

const mockCheckGate = jest.fn();
jest.mock('@/helpers/solution-plan-gate', () => ({
  checkSolutionPlanGate: (...a: unknown[]) => mockCheckGate(...a),
}));

const mockEnqueue = jest.fn();
jest.mock('@/helpers/document-generation-queue', () => ({
  enqueueDocumentGeneration: (...a: unknown[]) => mockEnqueue(...a),
}));

import { baseHandler } from './generate-document';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const project = { id: 'proj-1', sort_key: 'org-1#proj-1' };

const buildEvent = (body: Record<string, unknown>): AuthedEvent =>
  ({
    body: JSON.stringify(body),
    auth: { orgId: 'org-1', userId: 'user-1' },
  }) as unknown as AuthedEvent;

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetProjectById.mockResolvedValue(project);
  mockCheckGate.mockResolvedValue({ allowed: true, solutionPlanStatus: 'READY' });
  mockPutRFPDocument.mockResolvedValue(undefined);
  mockUpdateMetadata.mockResolvedValue({});
  mockEnqueue.mockResolvedValue(undefined);
});

describe('generate-document handler — validation & lookup', () => {
  it('returns 400 on an invalid body', async () => {
    const res = await baseHandler(buildEvent({ projectId: '' }));
    expect(statusOf(res)).toBe(400);
    expect(mockPutRFPDocument).not.toHaveBeenCalled();
  });

  it('returns 404 when the project does not exist', async () => {
    mockGetProjectById.mockResolvedValue(null);
    const res = await baseHandler(buildEvent({ projectId: 'proj-1' }));
    expect(statusOf(res)).toBe(404);
  });
});

describe('generate-document handler — solution plan gate', () => {
  const gatedBody = {
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    documentType: 'COST_PROPOSAL',
  };

  it('returns 409 SOLUTION_PLAN_REQUIRED when the gate blocks', async () => {
    mockCheckGate.mockResolvedValue({ allowed: false, solutionPlanStatus: null });

    const res = await baseHandler(buildEvent(gatedBody));

    expect(statusOf(res)).toBe(409);
    expect(bodyOf(res)).toMatchObject({
      code: 'SOLUTION_PLAN_REQUIRED',
      solutionPlanStatus: null,
    });
    expect(mockCheckGate).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      documentType: 'COST_PROPOSAL',
    });
    expect(mockPutRFPDocument).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('surfaces the in-progress plan status in the 409 body', async () => {
    mockCheckGate.mockResolvedValue({ allowed: false, solutionPlanStatus: 'GRILLING' });

    const res = await baseHandler(buildEvent(gatedBody));

    expect(statusOf(res)).toBe(409);
    expect(bodyOf(res)).toMatchObject({ solutionPlanStatus: 'GRILLING' });
  });

  it('creates the placeholder and enqueues when the gate passes', async () => {
    const res = await baseHandler(buildEvent(gatedBody));

    expect(statusOf(res)).toBe(202);
    expect(bodyOf(res)).toMatchObject({ status: 'GENERATING', documentType: 'COST_PROPOSAL' });
    expect(mockPutRFPDocument).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', documentType: 'COST_PROPOSAL' }),
    );
  });

  it('does not gate regeneration of an existing document', async () => {
    mockCheckGate.mockResolvedValue({ allowed: false, solutionPlanStatus: null });

    const res = await baseHandler(buildEvent({ ...gatedBody, documentId: 'doc-1' }));

    expect(statusOf(res)).toBe(202);
    expect(mockCheckGate).not.toHaveBeenCalled();
    expect(mockUpdateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1' }),
    );
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it('defaults opportunityId to "default" in the gate check', async () => {
    await baseHandler(buildEvent({ projectId: 'proj-1', documentType: 'TECHNICAL_PROPOSAL' }));

    expect(mockCheckGate).toHaveBeenCalledWith(
      expect.objectContaining({ opportunityId: 'default' }),
    );
  });
});

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
const mockGetRFPDocument = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  putRFPDocument: (...a: unknown[]) => mockPutRFPDocument(...a),
  updateRFPDocumentMetadata: (...a: unknown[]) => mockUpdateMetadata(...a),
  getRFPDocument: (...a: unknown[]) => mockGetRFPDocument(...a),
}));

const mockCheckGate = jest.fn();
jest.mock('@/helpers/generation-preconditions', () => ({
  checkGenerationPreconditions: (...a: unknown[]) => mockCheckGate(...a),
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
  mockCheckGate.mockResolvedValue({ allowed: true });
  mockPutRFPDocument.mockResolvedValue(undefined);
  mockUpdateMetadata.mockResolvedValue({});
  mockGetRFPDocument.mockResolvedValue({ documentId: 'doc-1', documentType: 'COST_PROPOSAL' });
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

describe('generate-document handler — pre-generation gate', () => {
  const gatedBody = {
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    documentType: 'COST_PROPOSAL',
  };

  /** The refusal shape the gate returns; the handler passes it through verbatim. */
  const refuse = (refusal: Record<string, unknown>) =>
    mockCheckGate.mockResolvedValue({ allowed: false, refusal });

  it('returns 409 SOLUTION_PLAN_REQUIRED when the gate blocks', async () => {
    refuse({
      code: 'SOLUTION_PLAN_REQUIRED',
      message: 'A ready Solution Plan is required before generating this document type.',
      solutionPlanStatus: null,
    });

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
    refuse({
      code: 'SOLUTION_PLAN_REQUIRED',
      message: 'A ready Solution Plan is required before generating this document type.',
      solutionPlanStatus: 'GRILLING',
    });

    const res = await baseHandler(buildEvent(gatedBody));

    expect(statusOf(res)).toBe(409);
    expect(bodyOf(res)).toMatchObject({ solutionPlanStatus: 'GRILLING' });
  });

  it('returns 409 KB_COVERAGE_INCOMPLETE with the named missing categories', async () => {
    refuse({
      code: 'KB_COVERAGE_INCOMPLETE',
      message:
        'The knowledge base is missing content this document type requires: personnel bios, certification records.',
      missingCategories: [
        { key: 'PERSONNEL_BIOS', label: 'personnel bios' },
        { key: 'CERTIFICATIONS', label: 'certification records' },
      ],
    });

    const res = await baseHandler(
      buildEvent({ ...gatedBody, documentType: 'TEAM_QUALIFICATIONS' }),
    );

    expect(statusOf(res)).toBe(409);
    expect(bodyOf(res)).toMatchObject({
      code: 'KB_COVERAGE_INCOMPLETE',
      missingCategories: [
        { key: 'PERSONNEL_BIOS', label: 'personnel bios' },
        { key: 'CERTIFICATIONS', label: 'certification records' },
      ],
    });
  });

  it('starts no generation at all on a coverage refusal', async () => {
    // AC #2: forcing generation must not leave a placeholder or queued job behind.
    refuse({
      code: 'KB_COVERAGE_INCOMPLETE',
      message: 'missing personnel bios',
      missingCategories: [{ key: 'PERSONNEL_BIOS', label: 'personnel bios' }],
    });

    await baseHandler(buildEvent({ ...gatedBody, documentType: 'TEAM_QUALIFICATIONS' }));

    expect(mockPutRFPDocument).not.toHaveBeenCalled();
    expect(mockUpdateMetadata).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
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
    refuse({ code: 'SOLUTION_PLAN_REQUIRED', message: 'blocked', solutionPlanStatus: null });

    const res = await baseHandler(buildEvent({ ...gatedBody, documentId: 'doc-1' }));

    expect(statusOf(res)).toBe(202);
    expect(mockCheckGate).not.toHaveBeenCalled();
    expect(mockGetRFPDocument).toHaveBeenCalledWith('proj-1', 'opp-1', 'doc-1');
    expect(mockUpdateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1' }),
    );
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it('returns 404 for a documentId that does not exist — no phantom record, no enqueue', async () => {
    mockGetRFPDocument.mockResolvedValue(null);

    const res = await baseHandler(buildEvent({ ...gatedBody, documentId: 'doc-forged' }));

    expect(statusOf(res)).toBe(404);
    expect(mockUpdateMetadata).not.toHaveBeenCalled();
    expect(mockPutRFPDocument).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('defaults opportunityId to "default" in the gate check', async () => {
    await baseHandler(buildEvent({ projectId: 'proj-1', documentType: 'TECHNICAL_PROPOSAL' }));

    expect(mockCheckGate).toHaveBeenCalledWith(
      expect.objectContaining({ opportunityId: 'default' }),
    );
  });
});

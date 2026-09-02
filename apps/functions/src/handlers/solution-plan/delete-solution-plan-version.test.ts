/**
 * Tests for DELETE /solution-plan/version (u2-version-history-api).
 *
 * Mocks middy + u1's C3 helper module before imports; tests the exported
 * business function directly. The guards live in u1's helper — the handler
 * maps outcomes: NOT_FOUND → 404 (BR3.3), REFUSED_CURRENT → 409 (BR3.1),
 * DELETED → 200. Guard rejections are RETURNED (never thrown, NFR1.14);
 * storage errors propagate uncaught (NFR1.15).
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

const mockDeleteVersion = jest.fn();
jest.mock('@/helpers/solution-plan-version', () => ({
  deleteSolutionPlanVersion: (...a: unknown[]) => mockDeleteVersion(...a),
}));

import { deletePlanVersion } from './delete-solution-plan-version';

const key = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const query = { ...key, versionId: 'ver-1' };
const event = { queryStringParameters: query } as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteVersion.mockResolvedValue({ outcome: 'DELETED' });
});

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

describe('delete-solution-plan-version handler', () => {
  it('returns 400 when versionId is missing', async () => {
    const res = await deletePlanVersion({ queryStringParameters: key } as never);
    expect(statusOf(res)).toBe(400);
    expect(mockDeleteVersion).not.toHaveBeenCalled();
  });

  it('deletes a non-current version (happy path)', async () => {
    const res = await deletePlanVersion(event);

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res)).toEqual({ ok: true, versionId: 'ver-1' });
    expect(mockDeleteVersion).toHaveBeenCalledTimes(1);
    expect(mockDeleteVersion).toHaveBeenCalledWith(key, 'ver-1');
  });

  it('maps NOT_FOUND to a RETURNED 404 — an already-deleted version (BR3.3)', async () => {
    mockDeleteVersion.mockResolvedValue({ outcome: 'NOT_FOUND' });

    const res = await deletePlanVersion(event);

    expect(statusOf(res)).toBe(404);
    expect(bodyOf(res)).toMatchObject({ message: 'Version not found' });
  });

  it('maps REFUSED_CURRENT to a RETURNED 409 — the current version is not deletable (BR3.1)', async () => {
    mockDeleteVersion.mockResolvedValue({ outcome: 'REFUSED_CURRENT' });

    const res = await deletePlanVersion(event);

    expect(statusOf(res)).toBe(409);
    expect(bodyOf(res)).toMatchObject({ code: 'SOLUTION_PLAN_VERSION_CURRENT' });
  });

  it('never throws on guard outcomes (Sentry visibility: rejections are returned values)', async () => {
    mockDeleteVersion.mockResolvedValue({ outcome: 'REFUSED_CURRENT' });
    await expect(deletePlanVersion(event)).resolves.toBeDefined();

    mockDeleteVersion.mockResolvedValue({ outcome: 'NOT_FOUND' });
    await expect(deletePlanVersion(event)).resolves.toBeDefined();
  });

  it('lets storage errors propagate uncaught (withSentryLambda reports them)', async () => {
    mockDeleteVersion.mockRejectedValue(new Error('DeleteItem failed'));

    await expect(deletePlanVersion(event)).rejects.toThrow('DeleteItem failed');
  });
});

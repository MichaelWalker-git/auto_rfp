/**
 * Tests for POST /solution-plan/version/restore (u3-version-restore).
 *
 * Mocks middy + the orchestration helper before imports; tests the exported
 * business function directly. The pipeline lives in the helper — the handler
 * validates, derives the restorer server-side, and maps outcomes:
 * SOURCE_NOT_FOUND → 404, CURRENT_VERSION / GENERATING → 409 (distinct
 * codes), RESTORED → 200 { ok, newVersion }. Guard rejections are RETURNED
 * (never thrown, NFR1.22); unexpected errors propagate uncaught.
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

const mockRestore = jest.fn();
jest.mock('@/helpers/solution-plan-restore', () => ({
  restoreSolutionPlanVersion: (...a: unknown[]) => mockRestore(...a),
}));

import { restorePlanVersion } from './restore-solution-plan-version';

const key = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const body = { ...key, versionId: 'ver-3' };

const newVersion = {
  versionId: 'ver-new',
  versionNumber: 8,
  origin: 'restore',
  createdBy: 'user-1',
  createdByName: 'Alice Example',
  createdAt: '2026-08-28T00:00:00.000Z',
};

const makeEvent = (overrides: Record<string, unknown> = {}) =>
  ({
    body: JSON.stringify(body),
    auth: {
      userId: 'user-1',
      claims: { name: 'Alice Example', email: 'alice@example.com' },
    },
    requestContext: { requestId: 'req-abc' },
    ...overrides,
  }) as never;

let infoSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockRestore.mockResolvedValue({ outcome: 'RESTORED', newVersion });
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  infoSpy.mockRestore();
});

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

describe('restore-solution-plan-version handler', () => {
  it('returns 400 with issue details when the body is invalid — helper never called', async () => {
    const res = await restorePlanVersion(makeEvent({ body: JSON.stringify(key) })); // no versionId

    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res)).toMatchObject({ message: 'Validation failed' });
    expect(bodyOf(res).issues).toBeDefined();
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('restores and returns 200 { ok, newVersion } — identity server-derived, requestId forwarded (happy path)', async () => {
    const res = await restorePlanVersion(makeEvent());

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res)).toEqual({
      ok: true,
      newVersion: { ...newVersion, createdAt: expect.any(String) },
    });
    expect(mockRestore).toHaveBeenCalledTimes(1);
    expect(mockRestore).toHaveBeenCalledWith({
      key,
      versionId: 'ver-3',
      restoredBy: 'user-1', // from auth context — never the request body
      restoredByName: 'Alice Example', // claims.name ?? claims.email precedent
      requestId: 'req-abc',
    });
  });

  it('falls back to claims.email for the display name when claims.name is absent', async () => {
    await restorePlanVersion(
      makeEvent({ auth: { userId: 'user-1', claims: { email: 'alice@example.com' } } }),
    );

    expect(mockRestore).toHaveBeenCalledWith(
      expect.objectContaining({ restoredByName: 'alice@example.com' }),
    );
  });

  it('returns 200 with newVersion null when capture failed fail-open — restore still succeeded', async () => {
    mockRestore.mockResolvedValue({ outcome: 'RESTORED', newVersion: null });

    const res = await restorePlanVersion(makeEvent());

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res)).toEqual({ ok: true, newVersion: null });
  });

  it('maps SOURCE_NOT_FOUND to a RETURNED 404 — source vanished (BR2.3)', async () => {
    mockRestore.mockResolvedValue({ outcome: 'SOURCE_NOT_FOUND' });

    const res = await restorePlanVersion(makeEvent());

    expect(statusOf(res)).toBe(404);
    expect(bodyOf(res)).toMatchObject({ message: 'Source version not found' });
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('"reason":"SOURCE_NOT_FOUND"'));
  });

  it('maps CURRENT_VERSION to a RETURNED 409 with its distinct code (BR2.1)', async () => {
    mockRestore.mockResolvedValue({ outcome: 'CURRENT_VERSION' });

    const res = await restorePlanVersion(makeEvent());

    expect(statusOf(res)).toBe(409);
    expect(bodyOf(res)).toMatchObject({ code: 'SOLUTION_PLAN_VERSION_CURRENT' });
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('"reason":"CURRENT_VERSION"'));
  });

  it('maps GENERATING to a RETURNED 409 with its distinct code (BR2.2)', async () => {
    mockRestore.mockResolvedValue({ outcome: 'GENERATING' });

    const res = await restorePlanVersion(makeEvent());

    expect(statusOf(res)).toBe(409);
    expect(bodyOf(res)).toMatchObject({ code: 'SOLUTION_PLAN_GENERATING' });
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('"reason":"GENERATING"'));
  });

  it('returns 401 when no authenticated user id resolves — the pipeline never runs (NFR3.12)', async () => {
    const res = await restorePlanVersion(
      makeEvent({ auth: undefined, requestContext: { requestId: 'req-abc' } }),
    );

    expect(statusOf(res)).toBe(401);
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('never throws on guard outcomes (rejections are returned values, NFR1.22)', async () => {
    for (const outcome of ['SOURCE_NOT_FOUND', 'CURRENT_VERSION', 'GENERATING'] as const) {
      mockRestore.mockResolvedValue({ outcome });
      await expect(restorePlanVersion(makeEvent())).resolves.toBeDefined();
    }
  });

  it('lets unexpected pipeline errors propagate uncaught (withSentryLambda reports them)', async () => {
    mockRestore.mockRejectedValue(new Error('CopyObject failed'));

    await expect(restorePlanVersion(makeEvent())).rejects.toThrow('CopyObject failed');
  });
});

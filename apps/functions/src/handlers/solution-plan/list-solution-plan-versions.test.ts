/**
 * Tests for GET /solution-plan/versions (u2-version-history-api).
 *
 * Mocks middy + u1's C3 helper module before imports and tests the exported
 * business function directly. Key assertions: ONE helper call serves the
 * whole response (currentVersionId derived from the query result — no plan
 * read exists in the handler), and storage errors propagate uncaught so
 * withSentryLambda reports them.
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

const mockListVersions = jest.fn();
const mockToListItem = jest.fn();
jest.mock('@/helpers/solution-plan-version', () => ({
  listSolutionPlanVersions: (...a: unknown[]) => mockListVersions(...a),
  toSolutionPlanVersionListItem: (...a: unknown[]) => mockToListItem(...a),
}));

import { SYSTEM_CREATED_BY, SYSTEM_CREATED_BY_NAME } from '@auto-rfp/core';

import { listPlanVersions } from './list-solution-plan-versions';

const query = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const event = { queryStringParameters: query } as never;

/** Full SolutionPlanVersionItem fixtures as u1's helper returns them (newest first). */
const versionItem = (versionId: string, versionNumber: number, extra: object = {}) => ({
  versionId,
  versionNumber,
  ...query,
  solutionPlanId: 'plan-1',
  htmlContentKey: `org-1/proj-1/opp-1/solution-plan/v${versionNumber}/solution-plan.html`,
  origin: 'generation',
  createdBy: 'user-1',
  createdByName: 'Alice Example',
  createdAt: '2026-08-28T00:00:00.000Z',
  ...extra,
});

/** The real projection's shape, mimicked so pass-through can be asserted. */
const project = (item: ReturnType<typeof versionItem>) => ({
  versionId: item.versionId,
  versionNumber: item.versionNumber,
  origin: item.origin,
  createdBy: item.createdBy,
  createdByName: item.createdByName,
  createdAt: item.createdAt,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockToListItem.mockImplementation((item) => project(item as ReturnType<typeof versionItem>));
});

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

describe('list-solution-plan-versions handler', () => {
  it('returns 400 when the key triple is missing (org scope from the request)', async () => {
    const res = await listPlanVersions({ queryStringParameters: {} } as never);
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res)).toMatchObject({ message: 'Validation failed' });
    expect(mockListVersions).not.toHaveBeenCalled();
  });

  it('returns the projected rows with currentVersionId = the newest row (happy path)', async () => {
    const newest = versionItem('ver-3', 3, { origin: 'manual-save', label: 'Reviewed' });
    mockListVersions.mockResolvedValue([newest, versionItem('ver-2', 2), versionItem('ver-1', 1)]);

    const res = await listPlanVersions(event);

    expect(statusOf(res)).toBe(200);
    const body = bodyOf(res);
    expect(body.currentVersionId).toBe('ver-3');
    expect(body.versions).toHaveLength(3);
    expect((body.versions as Record<string, unknown>[])[0]).toMatchObject({
      versionId: 'ver-3',
      versionNumber: 3,
      origin: 'manual-save',
      createdAt: expect.any(String),
    });
    expect(mockToListItem).toHaveBeenCalledTimes(3);
  });

  it('derives currentVersionId from the SAME single query — one helper call, no plan read', async () => {
    mockListVersions.mockResolvedValue([versionItem('ver-9', 9), versionItem('ver-8', 8)]);

    const res = await listPlanVersions(event);

    expect(mockListVersions).toHaveBeenCalledTimes(1);
    expect(mockListVersions).toHaveBeenCalledWith(query);
    expect(bodyOf(res).currentVersionId).toBe('ver-9');
  });

  it('returns 200 with an empty array and a null marker for an empty history', async () => {
    mockListVersions.mockResolvedValue([]);

    const res = await listPlanVersions(event);

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res)).toEqual({ ok: true, versions: [], currentVersionId: null });
  });

  it('passes the SYSTEM attribution sentinel through untouched', async () => {
    mockListVersions.mockResolvedValue([
      versionItem('ver-1', 1, {
        createdBy: SYSTEM_CREATED_BY,
        createdByName: SYSTEM_CREATED_BY_NAME,
      }),
    ]);

    const res = await listPlanVersions(event);

    expect((bodyOf(res).versions as Record<string, unknown>[])[0]).toMatchObject({
      createdBy: SYSTEM_CREATED_BY,
      createdByName: SYSTEM_CREATED_BY_NAME,
    });
  });

  it('lets storage errors propagate uncaught (withSentryLambda reports them)', async () => {
    mockListVersions.mockRejectedValue(new Error('DynamoDB unavailable'));

    await expect(listPlanVersions(event)).rejects.toThrow('DynamoDB unavailable');
  });
});

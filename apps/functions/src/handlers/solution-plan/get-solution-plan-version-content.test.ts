/**
 * Tests for GET /solution-plan/version/content (u2-version-history-api).
 *
 * Mocks middy + u1's C3 helper module + the plan-content S3 loader before
 * imports; tests the exported business function directly. Key assertions:
 * the S3 key comes from the LOCATED RECORD's own `htmlContentKey` (never
 * client input — NFR3.8), a vanished version is a RETURNED 404 (never
 * thrown), and storage errors propagate uncaught.
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

const mockGetVersion = jest.fn();
const mockToListItem = jest.fn();
jest.mock('@/helpers/solution-plan-version', () => ({
  getSolutionPlanVersion: (...a: unknown[]) => mockGetVersion(...a),
  toSolutionPlanVersionListItem: (...a: unknown[]) => mockToListItem(...a),
}));

const mockLoadHtml = jest.fn();
jest.mock('@/helpers/solution-plan', () => ({
  loadSolutionPlanHtml: (...a: unknown[]) => mockLoadHtml(...a),
}));

import { getPlanVersionContent } from './get-solution-plan-version-content';

const key = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const query = { ...key, versionId: 'ver-2' };
const event = { queryStringParameters: query } as never;

const version = {
  versionId: 'ver-2',
  versionNumber: 2,
  ...key,
  solutionPlanId: 'plan-1',
  htmlContentKey: 'org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html',
  origin: 'manual-save',
  label: 'Pre-pricing review',
  createdBy: 'user-1',
  createdByName: 'Alice Example',
  createdAt: '2026-08-28T00:00:00.000Z',
};

const listItem = {
  versionId: version.versionId,
  versionNumber: version.versionNumber,
  origin: version.origin,
  label: version.label,
  createdBy: version.createdBy,
  createdByName: version.createdByName,
  createdAt: version.createdAt,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetVersion.mockResolvedValue(version);
  mockLoadHtml.mockResolvedValue('<h1>Plan v2</h1>');
  mockToListItem.mockReturnValue(listItem);
});

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

describe('get-solution-plan-version-content handler', () => {
  it('returns 400 when versionId is missing', async () => {
    const res = await getPlanVersionContent({ queryStringParameters: key } as never);
    expect(statusOf(res)).toBe(400);
    expect(mockGetVersion).not.toHaveBeenCalled();
    expect(mockLoadHtml).not.toHaveBeenCalled();
  });

  it('returns a RETURNED 404 (never thrown) when the version vanished, without a body fetch', async () => {
    mockGetVersion.mockResolvedValue(null);

    const res = await getPlanVersionContent(event);

    expect(statusOf(res)).toBe(404);
    expect(bodyOf(res)).toMatchObject({ message: 'Version not found' });
    expect(mockLoadHtml).not.toHaveBeenCalled();
  });

  it('locates the version within the requested plan scope', async () => {
    await getPlanVersionContent(event);
    expect(mockGetVersion).toHaveBeenCalledWith(key, 'ver-2');
  });

  it('fetches the body at the RECORD\'s own htmlContentKey — never a client-supplied key', async () => {
    const eventWithInjectedKey = {
      queryStringParameters: { ...query, htmlContentKey: 'attacker/other-org/key.html' },
    } as never;

    await getPlanVersionContent(eventWithInjectedKey);

    expect(mockLoadHtml).toHaveBeenCalledTimes(1);
    expect(mockLoadHtml).toHaveBeenCalledWith(version.htmlContentKey);
  });

  it('returns the html plus the version metadata (happy path)', async () => {
    const res = await getPlanVersionContent(event);

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res)).toEqual({
      ok: true,
      html: '<h1>Plan v2</h1>',
      version: { ...listItem, createdAt: expect.any(String) },
    });
    expect(mockToListItem).toHaveBeenCalledWith(version);
  });

  it('lets a body-fetch storage error propagate uncaught (withSentryLambda reports it)', async () => {
    mockLoadHtml.mockRejectedValue(new Error('S3 GetObject failed'));

    await expect(getPlanVersionContent(event)).rejects.toThrow('S3 GetObject failed');
  });
});

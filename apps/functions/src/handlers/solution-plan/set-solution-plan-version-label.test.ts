/**
 * Tests for PATCH /solution-plan/version/label (u2-version-history-api).
 *
 * Mocks middy + u1's C3 helper module before imports; tests the exported
 * business function directly. Key assertions: >100-char labels are a schema
 * 400 with nothing executed (BR2.1), empty/whitespace clears (BR2.2 — the
 * helper receives the raw value and REMOVEs), a vanished version is a
 * RETURNED 404 (never thrown, BR2.4), and the updated list item comes back.
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

const mockSetLabel = jest.fn();
const mockToListItem = jest.fn();
jest.mock('@/helpers/solution-plan-version', () => ({
  setSolutionPlanVersionLabel: (...a: unknown[]) => mockSetLabel(...a),
  toSolutionPlanVersionListItem: (...a: unknown[]) => mockToListItem(...a),
}));

import { setPlanVersionLabel } from './set-solution-plan-version-label';

const key = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };

const eventWith = (body: object) => ({ body: JSON.stringify(body) }) as never;

const updatedItem = {
  versionId: 'ver-2',
  versionNumber: 2,
  ...key,
  solutionPlanId: 'plan-1',
  htmlContentKey: 'org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html',
  origin: 'manual-save',
  label: 'Reviewed draft',
  createdBy: 'user-1',
  createdByName: 'Alice Example',
  createdAt: '2026-08-28T00:00:00.000Z',
};

const listItem = {
  versionId: updatedItem.versionId,
  versionNumber: updatedItem.versionNumber,
  origin: updatedItem.origin,
  label: updatedItem.label,
  createdBy: updatedItem.createdBy,
  createdByName: updatedItem.createdByName,
  createdAt: updatedItem.createdAt,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSetLabel.mockResolvedValue(updatedItem);
  mockToListItem.mockReturnValue(listItem);
});

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

describe('set-solution-plan-version-label handler', () => {
  it('returns 400 with issues for a label over 100 characters — nothing executed (BR2.1)', async () => {
    const res = await setPlanVersionLabel(
      eventWith({ ...key, versionId: 'ver-2', label: 'a'.repeat(101) }),
    );

    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res)).toMatchObject({ message: 'Validation failed', issues: expect.any(Array) });
    expect(mockSetLabel).not.toHaveBeenCalled();
  });

  it('returns 400 when versionId is missing from the body', async () => {
    const res = await setPlanVersionLabel(eventWith({ ...key, label: 'x' }));
    expect(statusOf(res)).toBe(400);
    expect(mockSetLabel).not.toHaveBeenCalled();
  });

  it('sets a label and returns the updated list item (happy path)', async () => {
    const res = await setPlanVersionLabel(
      eventWith({ ...key, versionId: 'ver-2', label: 'Reviewed draft' }),
    );

    expect(statusOf(res)).toBe(200);
    expect(mockSetLabel).toHaveBeenCalledWith(key, 'ver-2', 'Reviewed draft');
    expect(bodyOf(res)).toEqual({
      ok: true,
      version: { ...listItem, createdAt: expect.any(String) },
    });
    expect(mockToListItem).toHaveBeenCalledWith(updatedItem);
  });

  it('accepts a label of exactly 100 characters (boundary)', async () => {
    const label = 'a'.repeat(100);
    const res = await setPlanVersionLabel(eventWith({ ...key, versionId: 'ver-2', label }));

    expect(statusOf(res)).toBe(200);
    expect(mockSetLabel).toHaveBeenCalledWith(key, 'ver-2', label);
  });

  it('clears the label on whitespace-only input (BR2.2 — helper receives the raw value)', async () => {
    mockSetLabel.mockResolvedValue({ ...updatedItem, label: undefined });
    mockToListItem.mockReturnValue({ ...listItem, label: undefined });

    const res = await setPlanVersionLabel(eventWith({ ...key, versionId: 'ver-2', label: '   ' }));

    expect(statusOf(res)).toBe(200);
    expect(mockSetLabel).toHaveBeenCalledWith(key, 'ver-2', '   ');
  });

  it('clears the label when it is omitted from the body', async () => {
    mockSetLabel.mockResolvedValue({ ...updatedItem, label: undefined });
    mockToListItem.mockReturnValue({ ...listItem, label: undefined });

    const res = await setPlanVersionLabel(eventWith({ ...key, versionId: 'ver-2' }));

    expect(statusOf(res)).toBe(200);
    expect(mockSetLabel).toHaveBeenCalledWith(key, 'ver-2', undefined);
  });

  it('returns a RETURNED 404 (never thrown) when the version vanished (BR2.4)', async () => {
    mockSetLabel.mockResolvedValue(null);

    const res = await setPlanVersionLabel(
      eventWith({ ...key, versionId: 'ver-gone', label: 'x' }),
    );

    expect(statusOf(res)).toBe(404);
    expect(bodyOf(res)).toMatchObject({ message: 'Version not found' });
  });

  it('lets storage errors propagate uncaught (withSentryLambda reports them)', async () => {
    mockSetLabel.mockRejectedValue(new Error('conditional update failed hard'));

    await expect(
      setPlanVersionLabel(eventWith({ ...key, versionId: 'ver-2', label: 'x' })),
    ).rejects.toThrow('conditional update failed hard');
  });
});

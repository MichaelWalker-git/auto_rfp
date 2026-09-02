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

const mockSaveUserEditedTeam = jest.fn();
jest.mock('@/helpers/plan-team', () => ({
  saveUserEditedTeam: (...a: unknown[]) => mockSaveUserEditedTeam(...a),
}));

import { savePlanTeam } from './save-plan-team';

const key = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const members = [
  {
    employeeId: 'emp-1',
    nameSnapshot: 'Jane Doe',
    role: 'Senior Engineer',
    source: 'MANUAL',
  },
];
const makeEvent = (body: unknown) => ({ body: JSON.stringify(body) }) as never;

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('save-plan-team handler', () => {
  it('returns 400 on a missing members array', async () => {
    const res = await savePlanTeam(makeEvent({ ...key }));
    expect(statusOf(res)).toBe(400);
    expect(mockSaveUserEditedTeam).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid line shape (filled line without nameSnapshot)', async () => {
    const res = await savePlanTeam(
      makeEvent({ ...key, members: [{ employeeId: 'emp-1', role: 'Engineer' }] }),
    );
    expect(statusOf(res)).toBe(400);
  });

  it('returns 404 when the plan does not exist', async () => {
    mockSaveUserEditedTeam.mockResolvedValue(null);
    const res = await savePlanTeam(makeEvent({ ...key, members }));
    expect(statusOf(res)).toBe(404);
  });

  it('persists and returns the saved team (userModified + savedAt)', async () => {
    const saved = {
      members,
      userModified: true,
      savedAt: '2026-08-19T12:00:00.000Z',
    };
    mockSaveUserEditedTeam.mockResolvedValue(saved);

    const res = await savePlanTeam(makeEvent({ ...key, members }));

    expect(statusOf(res)).toBe(200);
    expect(mockSaveUserEditedTeam).toHaveBeenCalledWith(
      key,
      // Zod applies line defaults before the helper sees the members
      [expect.objectContaining({ employeeId: 'emp-1', removedEmployee: false, source: 'MANUAL' })],
    );
    expect(bodyOf(res)).toEqual({ ok: true, team: saved });
  });
});

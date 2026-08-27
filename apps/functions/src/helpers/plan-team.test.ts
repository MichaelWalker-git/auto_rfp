/**
 * Tests for the plan-team persistence helpers (U3): derive-on-read
 * removedEmployee (BR3.3, the pinned design decision), save semantics
 * (BR3.1), synthesis-attach preservation (BR1.1/BR1.2), and the explicit
 * regenerate contract (W4, BR4.2).
 */
const mockGetPlan = jest.fn();
jest.mock('@/helpers/solution-plan', () => ({
  getSolutionPlanByOpportunity: (...a: unknown[]) => mockGetPlan(...a),
  buildSolutionPlanSk: (key: { orgId: string; projectId: string; opportunityId: string }) =>
    `${key.orgId}#${key.projectId}#${key.opportunityId}`,
}));

const mockListEmployees = jest.fn();
jest.mock('@/helpers/employee', () => ({
  listEmployeesByOrg: (...a: unknown[]) => mockListEmployees(...a),
}));

const mockUpdateItem = jest.fn();
jest.mock('@/helpers/db', () => ({
  updateItem: (...a: unknown[]) => mockUpdateItem(...a),
}));

const mockGenerateTeam = jest.fn();
jest.mock('@/helpers/team-matching', () => ({
  generateTeamRecommendation: (...a: unknown[]) => mockGenerateTeam(...a),
}));

import type { PlanTeam, PlanTeamMember } from '@auto-rfp/core';

import { SOLUTION_PLAN_PK } from '@/constants/solution-plan';
import {
  attachGeneratedTeam,
  deriveTeamMembers,
  getDerivedPlanTeam,
  regenerateTeam,
  saveUserEditedTeam,
} from './plan-team';

const key = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const expectedSk = 'org-1#proj-1#opp-1';

const filledMember = (over: Partial<PlanTeamMember> = {}): PlanTeamMember => ({
  employeeId: 'emp-1',
  nameSnapshot: 'Old Name',
  role: 'Senior Engineer',
  rationale: 'AWS certified match.',
  removedEmployee: false,
  source: 'AI_RECOMMENDED',
  ...over,
});

const team = (over: Partial<PlanTeam> = {}): PlanTeam => ({
  members: [filledMember()],
  userModified: false,
  generatedAt: '2026-08-19T10:00:00.000Z',
  ...over,
});

const plan = (over: Record<string, unknown> = {}) => ({
  id: 'plan-1',
  ...key,
  status: 'READY',
  runId: 'run-1',
  version: 3,
  isStale: false,
  isUserEdited: false,
  ...over,
});

const liveEmployee = { id: 'emp-1', orgId: 'org-1', name: 'Jane Doe', primaryRoles: [], secondaryRoles: [], certifications: [], source: 'MANUAL' };

beforeEach(() => {
  jest.clearAllMocks();
  mockListEmployees.mockResolvedValue([liveEmployee]);
  mockUpdateItem.mockResolvedValue({});
});

describe('deriveTeamMembers (BR3.3 — derived on read)', () => {
  it('refreshes the snapshot and clears the mark for a live employee', () => {
    const [derived] = deriveTeamMembers([filledMember()], new Map([[liveEmployee.id, liveEmployee]]));
    expect(derived).toMatchObject({
      employeeId: 'emp-1',
      nameSnapshot: 'Jane Doe',
      removedEmployee: false,
    });
  });

  it('marks a dangling reference: employeeId dropped, snapshot + rationale retained', () => {
    const [derived] = deriveTeamMembers([filledMember()], new Map());
    expect(derived.employeeId).toBeUndefined();
    expect(derived).toMatchObject({
      nameSnapshot: 'Old Name',
      rationale: 'AWS certified match.',
      removedEmployee: true,
    });
  });

  it('passes UNFILLED lines through untouched', () => {
    const unfilled: PlanTeamMember = { role: 'Open Slot', removedEmployee: false, source: 'AI_RECOMMENDED' };
    expect(deriveTeamMembers([unfilled], new Map())).toEqual([unfilled]);
  });
});

describe('getDerivedPlanTeam', () => {
  it('reports a missing plan', async () => {
    mockGetPlan.mockResolvedValue(null);
    expect(await getDerivedPlanTeam(key)).toEqual({ planExists: false, team: null });
  });

  it('returns team null without hitting the pool when no team exists yet', async () => {
    mockGetPlan.mockResolvedValue(plan());
    expect(await getDerivedPlanTeam(key)).toEqual({ planExists: true, team: null });
    expect(mockListEmployees).not.toHaveBeenCalled();
  });

  it('derives removedEmployee against the pool on read', async () => {
    mockGetPlan.mockResolvedValue(
      plan({ planTeam: team({ members: [filledMember(), filledMember({ employeeId: 'emp-gone', nameSnapshot: 'Gone Person' })] }) }),
    );

    const { team: derived } = await getDerivedPlanTeam(key);

    expect(derived?.members[0]).toMatchObject({ employeeId: 'emp-1', nameSnapshot: 'Jane Doe', removedEmployee: false });
    expect(derived?.members[1].employeeId).toBeUndefined();
    expect(derived?.members[1]).toMatchObject({ nameSnapshot: 'Gone Person', removedEmployee: true });
    // Read-only: derive-on-read never writes back
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });
});

describe('saveUserEditedTeam (BR3.1)', () => {
  it('persists the derived team with userModified + savedAt and bumps the version', async () => {
    mockGetPlan.mockResolvedValue(plan({ planTeam: team() }));

    const saved = await saveUserEditedTeam(key, [filledMember({ nameSnapshot: 'Stale Name' })]);

    expect(saved).toMatchObject({
      userModified: true,
      savedAt: expect.any(String),
      generatedAt: '2026-08-19T10:00:00.000Z',
    });
    // Snapshot refreshed from the live pool on save
    expect(saved?.members[0]).toMatchObject({ nameSnapshot: 'Jane Doe' });

    expect(mockUpdateItem).toHaveBeenCalledWith(SOLUTION_PLAN_PK, expectedSk, {
      planTeam: saved,
      version: 4,
    });
  });

  it('returns null (nothing written) when the plan does not exist', async () => {
    mockGetPlan.mockResolvedValue(null);
    expect(await saveUserEditedTeam(key, [filledMember()])).toBeNull();
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });
});

describe('attachGeneratedTeam (BR1.1/BR1.2)', () => {
  it('preserves a user-modified team without even running matching (BR1.2)', async () => {
    mockGetPlan.mockResolvedValue(plan({ planTeam: team({ userModified: true }) }));

    expect(await attachGeneratedTeam(key)).toBe('PRESERVED_USER_MODIFIED');
    expect(mockGenerateTeam).not.toHaveBeenCalled();
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  it('attaches a fresh recommendation with generatedAt and userModified false (BR1.1)', async () => {
    mockGetPlan.mockResolvedValue(plan({ planTeam: team() }));
    mockGenerateTeam.mockResolvedValue({ members: [filledMember()], emptyPool: false });

    expect(await attachGeneratedTeam(key)).toBe('ATTACHED');

    expect(mockUpdateItem).toHaveBeenCalledWith(SOLUTION_PLAN_PK, expectedSk, {
      planTeam: {
        members: [filledMember()],
        userModified: false,
        generatedAt: expect.any(String),
      },
    });
  });

  it('leaves the team untouched on an empty pool (BR4.1)', async () => {
    mockGetPlan.mockResolvedValue(plan());
    mockGenerateTeam.mockResolvedValue({ members: [], emptyPool: true });

    expect(await attachGeneratedTeam(key)).toBe('EMPTY_POOL');
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });
});

describe('regenerateTeam (W4)', () => {
  it('replaces the team, resets userModified, clears savedAt, bumps version', async () => {
    mockGetPlan.mockResolvedValue(
      plan({ planTeam: team({ userModified: true, savedAt: '2026-08-19T11:00:00.000Z' }) }),
    );
    mockGenerateTeam.mockResolvedValue({ members: [filledMember()], emptyPool: false });

    const result = await regenerateTeam(key);

    expect(result.status).toBe('REGENERATED');
    if (result.status !== 'REGENERATED') throw new Error('unreachable');
    expect(result.team.userModified).toBe(false);
    expect(result.team.savedAt).toBeUndefined();
    expect(mockUpdateItem).toHaveBeenCalledWith(SOLUTION_PLAN_PK, expectedSk, {
      planTeam: result.team,
      version: 4,
    });
  });

  it('reports the empty pool as the prerequisite state, not an error (BR4.1)', async () => {
    mockGetPlan.mockResolvedValue(plan());
    mockGenerateTeam.mockResolvedValue({ members: [], emptyPool: true });

    expect(await regenerateTeam(key)).toEqual({ status: 'EMPTY_POOL' });
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  it('leaves the existing team untouched when matching fails (BR4.2)', async () => {
    mockGetPlan.mockResolvedValue(plan({ planTeam: team({ userModified: true }) }));
    mockGenerateTeam.mockRejectedValue(new Error('matching broke'));

    await expect(regenerateTeam(key)).rejects.toThrow('matching broke');
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  it('returns PLAN_NOT_FOUND when the plan is missing', async () => {
    mockGetPlan.mockResolvedValue(null);
    expect(await regenerateTeam(key)).toEqual({ status: 'PLAN_NOT_FOUND' });
    expect(mockGenerateTeam).not.toHaveBeenCalled();
  });
});

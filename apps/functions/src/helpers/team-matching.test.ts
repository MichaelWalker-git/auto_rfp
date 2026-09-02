/**
 * Tests for the plan-team matching engine (U3): staffing-plan slot sizing vs
 * AI-proposed slots (BR1.3), rationale enforcement with regenerate-once then
 * drop-to-unfilled (BR1.4), empty-pool prerequisite (BR4.1), typed failure
 * wrapping (BR4.2), and the deterministic scoring signals (BR5.2).
 */
const mockListEmployees = jest.fn();
jest.mock('@/helpers/employee', () => ({
  listEmployeesByOrg: (...a: unknown[]) => mockListEmployees(...a),
}));

const mockGetStaffingPlans = jest.fn();
jest.mock('@/helpers/pricing', () => ({
  getStaffingPlansByOpportunity: (...a: unknown[]) => mockGetStaffingPlans(...a),
}));

const mockLoadSolicitation = jest.fn();
jest.mock('@/helpers/document-generation', () => ({
  loadSolicitation: (...a: unknown[]) => mockLoadSolicitation(...a),
}));

const mockFetchBrief = jest.fn();
jest.mock('@/helpers/db-tool-helpers', () => ({
  fetchExecutiveBriefAnalysis: (...a: unknown[]) => mockFetchBrief(...a),
}));

const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...a: unknown[]) => mockInvokeModel(...a),
}));

process.env.BEDROCK_MODEL_ID = 'test-model';

import type { EmployeeItem, StaffingPlan } from '@auto-rfp/core';

import {
  TeamMatchingError,
  deriveSlotsFromStaffingPlans,
  generateTeamRecommendation,
  roleSimilarity,
  scoreCandidateForRole,
} from './team-matching';

const key = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };

const employee = (over: Partial<EmployeeItem> & Pick<EmployeeItem, 'id' | 'name'>): EmployeeItem => ({
  orgId: 'org-1',
  primaryRoles: [],
  secondaryRoles: [],
  certifications: [],
  source: 'MANUAL',
  ...over,
});

const pool: EmployeeItem[] = [
  employee({
    id: 'emp-pm',
    name: 'Alice PM',
    primaryRoles: ['Project Manager'],
    certifications: ['PMP'],
    location: 'ONSHORE',
  }),
  employee({
    id: 'emp-se',
    name: 'Bob Engineer',
    primaryRoles: ['Senior Engineer'],
    secondaryRoles: ['Cloud Architect'],
    certifications: ['AWS Solutions Architect'],
  }),
];

const staffingPlan = (over: Partial<StaffingPlan> = {}): StaffingPlan =>
  ({
    staffingPlanId: 'sp-1',
    orgId: 'org-1',
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    name: 'Base plan',
    laborItems: [
      { position: 'Project Manager', hours: 100, rate: 100, totalCost: 10_000 },
      { position: 'Senior Engineer', hours: 200, rate: 120, totalCost: 24_000 },
      // Duplicate position — must collapse to ONE slot
      { position: 'Senior Engineer', hours: 50, rate: 120, totalCost: 6_000, phase: 'Phase 2' },
    ],
    totalLaborCost: 40_000,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    createdBy: 'user-1',
    updatedBy: 'user-1',
    ...over,
  }) as StaffingPlan;

/** Encode a Bedrock-style response whose text content is the given payload. */
const bedrockResponse = (payload: unknown): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }] }),
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockListEmployees.mockResolvedValue(pool);
  mockGetStaffingPlans.mockResolvedValue([staffingPlan()]);
  mockLoadSolicitation.mockResolvedValue('Requires PMP certified project manager and AWS cloud engineer.');
  mockFetchBrief.mockResolvedValue('');
});

describe('deriveSlotsFromStaffingPlans (BR1.3)', () => {
  it('produces one slot per unique position, in plan order', () => {
    const slots = deriveSlotsFromStaffingPlans([staffingPlan()]);
    expect(slots).toEqual([
      { role: 'Project Manager', staffingPositionRef: 'Project Manager' },
      { role: 'Senior Engineer', staffingPositionRef: 'Senior Engineer' },
    ]);
  });

  it('uses the most recently updated staffing plan and returns [] with none', () => {
    const older = staffingPlan({ staffingPlanId: 'sp-old', updatedAt: '2026-07-01T00:00:00.000Z' });
    const newer = staffingPlan({
      staffingPlanId: 'sp-new',
      updatedAt: '2026-08-10T00:00:00.000Z',
      laborItems: [{ position: 'Data Scientist', hours: 10, rate: 150, totalCost: 1_500 }],
    });
    expect(deriveSlotsFromStaffingPlans([older, newer])).toEqual([
      { role: 'Data Scientist', staffingPositionRef: 'Data Scientist' },
    ]);
    expect(deriveSlotsFromStaffingPlans([])).toEqual([]);
  });
});

describe('deterministic scoring (BR5.2)', () => {
  it('scores an exact primary-role match above a partial secondary match', () => {
    const requirements = new Set(['aws', 'pmp']);
    const pmScore = scoreCandidateForRole(pool[0], 'Project Manager', requirements);
    const seScore = scoreCandidateForRole(pool[1], 'Project Manager', requirements);
    expect(pmScore).toBeGreaterThan(seScore);
  });

  it('roleSimilarity is 1 for identical roles and 0 for disjoint ones', () => {
    expect(roleSimilarity('Senior Engineer', 'Senior Engineer')).toBe(1);
    expect(roleSimilarity('Senior Engineer', 'Accountant')).toBe(0);
  });
});

describe('generateTeamRecommendation', () => {
  it('fills one member per staffing position with snapshot + rationale (BR1.3/BR1.4)', async () => {
    mockInvokeModel.mockResolvedValue(
      bedrockResponse({
        slots: [
          {
            role: 'Project Manager',
            staffingPositionRef: 'Project Manager',
            employeeId: 'emp-pm',
            rationale: 'PMP certified with direct PM experience.',
          },
          {
            role: 'Senior Engineer',
            staffingPositionRef: 'Senior Engineer',
            employeeId: 'emp-se',
            rationale: 'AWS Solutions Architect matching the cloud requirements.',
          },
        ],
      }),
    );

    const result = await generateTeamRecommendation(key);

    expect(result.emptyPool).toBe(false);
    expect(result.members).toEqual([
      expect.objectContaining({
        employeeId: 'emp-pm',
        nameSnapshot: 'Alice PM',
        role: 'Project Manager',
        staffingPositionRef: 'Project Manager',
        rationale: 'PMP certified with direct PM experience.',
        removedEmployee: false,
        source: 'AI_RECOMMENDED',
      }),
      expect.objectContaining({ employeeId: 'emp-se', nameSnapshot: 'Bob Engineer' }),
    ]);
    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
    // orgId propagates to invokeModel as the third argument (per-org Bedrock key).
    expect(mockInvokeModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      key.orgId,
    );
  });

  it('turns an unfillable position into an UNFILLED line and guards hallucinated ids', async () => {
    mockInvokeModel.mockResolvedValue(
      bedrockResponse({
        slots: [
          {
            role: 'Project Manager',
            staffingPositionRef: 'Project Manager',
            employeeId: 'emp-pm',
            rationale: 'PMP certified.',
          },
          // Hallucinated id — must degrade to unfilled, not leak into the team
          {
            role: 'Senior Engineer',
            staffingPositionRef: 'Senior Engineer',
            employeeId: 'emp-ghost',
            rationale: 'Invented person.',
          },
        ],
      }),
    );

    const { members } = await generateTeamRecommendation(key);

    expect(members[1]).toEqual({
      role: 'Senior Engineer',
      staffingPositionRef: 'Senior Engineer',
      removedEmployee: false,
      source: 'AI_RECOMMENDED',
    });
    expect(members[1].employeeId).toBeUndefined();
    expect(members[1].rationale).toBeUndefined();
  });

  it('uses AI-proposed slots when no staffing plan exists (BR1.3 / Q2)', async () => {
    mockGetStaffingPlans.mockResolvedValue([]);
    mockInvokeModel.mockResolvedValue(
      bedrockResponse({
        slots: [
          {
            role: 'Delivery Lead',
            staffingPositionRef: null,
            employeeId: 'emp-pm',
            rationale: 'Strongest management background for the requirements.',
          },
          { role: 'Security Analyst', staffingPositionRef: null, employeeId: null, rationale: null },
        ],
      }),
    );

    const { members } = await generateTeamRecommendation(key);

    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({ employeeId: 'emp-pm', role: 'Delivery Lead' });
    expect(members[0].staffingPositionRef).toBeUndefined();
    expect(members[1]).toMatchObject({ role: 'Security Analyst' });
    expect(members[1].employeeId).toBeUndefined();
  });

  it('regenerates ONCE on missing rationale, then drops the line to UNFILLED (BR1.4)', async () => {
    const withoutRationale = bedrockResponse({
      slots: [
        {
          role: 'Project Manager',
          staffingPositionRef: 'Project Manager',
          employeeId: 'emp-pm',
          rationale: null,
        },
        {
          role: 'Senior Engineer',
          staffingPositionRef: 'Senior Engineer',
          employeeId: 'emp-se',
          rationale: 'AWS certified.',
        },
      ],
    });
    mockInvokeModel.mockResolvedValue(withoutRationale);

    const { members } = await generateTeamRecommendation(key);

    expect(mockInvokeModel).toHaveBeenCalledTimes(2);
    // Still no rationale after the retry — the PM line degrades to unfilled
    expect(members[0]).toEqual({
      role: 'Project Manager',
      staffingPositionRef: 'Project Manager',
      removedEmployee: false,
      source: 'AI_RECOMMENDED',
    });
    // The valid line is untouched
    expect(members[1]).toMatchObject({ employeeId: 'emp-se', rationale: 'AWS certified.' });
  });

  it('returns the empty-pool prerequisite result without calling Bedrock (BR4.1)', async () => {
    mockListEmployees.mockResolvedValue([]);

    const result = await generateTeamRecommendation(key);

    expect(result).toEqual({ members: [], emptyPool: true });
    expect(mockInvokeModel).not.toHaveBeenCalled();
    expect(mockGetStaffingPlans).not.toHaveBeenCalled();
  });

  it('wraps Bedrock failures in TeamMatchingError (BR4.2)', async () => {
    mockInvokeModel.mockRejectedValue(new Error('bedrock 500'));

    await expect(generateTeamRecommendation(key)).rejects.toBeInstanceOf(TeamMatchingError);
  });

  it('wraps an unparseable model response in TeamMatchingError', async () => {
    mockInvokeModel.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({ content: [{ type: 'text', text: 'not json at all' }] }),
      ),
    );

    await expect(generateTeamRecommendation(key)).rejects.toThrow(
      /Unparseable Bedrock response/,
    );
  });

  it('still matches when solicitation/brief context loading fails (best-effort context)', async () => {
    mockLoadSolicitation.mockRejectedValue(new Error('no docs'));
    mockFetchBrief.mockRejectedValue(new Error('no brief'));
    mockInvokeModel.mockResolvedValue(
      bedrockResponse({
        slots: [
          {
            role: 'Project Manager',
            staffingPositionRef: 'Project Manager',
            employeeId: 'emp-pm',
            rationale: 'PMP certified.',
          },
          {
            role: 'Senior Engineer',
            staffingPositionRef: 'Senior Engineer',
            employeeId: null,
            rationale: null,
          },
        ],
      }),
    );

    const { members } = await generateTeamRecommendation(key);
    expect(members[0]).toMatchObject({ employeeId: 'emp-pm' });
  });
});

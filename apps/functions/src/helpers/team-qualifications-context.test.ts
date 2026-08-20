/**
 * Tests for the TEAM_QUALIFICATIONS grounding context (team-definition U4):
 *   - classifyTeamLine — BR2.5 fixed detection order + invalid-shape warning
 *   - hasSavedTeam — BR1.1 saved-team precondition
 *   - assembleTeamQualificationsContext — BR2.1–BR2.5 assembly incl. the
 *     stale-FILLED-reference fallback and CV degradation paths
 *   - renderTeamContextBlock — prompt block rendering + budget truncation
 */

// Mock integration boundaries BEFORE imports (repo convention).
const mockGetSolutionPlanByOpportunity = jest.fn();
jest.mock('@/helpers/solution-plan', () => ({
  getSolutionPlanByOpportunity: (...a: unknown[]) => mockGetSolutionPlanByOpportunity(...a),
}));

const mockListEmployeesByOrg = jest.fn();
jest.mock('@/helpers/employee', () => ({
  listEmployeesByOrg: (...a: unknown[]) => mockListEmployeesByOrg(...a),
}));

const mockGetDocumentItemByDocumentId = jest.fn();
jest.mock('@/helpers/document', () => ({
  getDocumentItemByDocumentId: (...a: unknown[]) => mockGetDocumentItemByDocumentId(...a),
}));

const mockLoadTextFromS3 = jest.fn();
jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: (...a: unknown[]) => mockLoadTextFromS3(...a),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.DOCUMENTS_BUCKET = 'test-documents-bucket';

import type { PlanTeamMember } from '@auto-rfp/core';
import {
  classifyTeamLine,
  hasSavedTeam,
  assembleTeamQualificationsContext,
  renderTeamContextBlock,
  TEAM_MEMBER_CV_TEXT_BUDGET,
  TEAM_CONTEXT_TEXT_BUDGET,
  type TeamQualificationsContext,
} from './team-qualifications-context';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const key = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };

const filledLine = (over: Partial<PlanTeamMember> = {}): PlanTeamMember => ({
  employeeId: 'emp-1',
  nameSnapshot: 'Jane Doe',
  role: 'Project Manager',
  rationale: 'PMP certified federal PM.',
  removedEmployee: false,
  source: 'AI_RECOMMENDED',
  ...over,
});

const deletedLine = (over: Partial<PlanTeamMember> = {}): PlanTeamMember => ({
  nameSnapshot: 'Gone Person',
  role: 'Senior Engineer',
  removedEmployee: true,
  source: 'AI_RECOMMENDED',
  ...over,
});

const unfilledLine = (over: Partial<PlanTeamMember> = {}): PlanTeamMember => ({
  role: 'Cloud Architect',
  removedEmployee: false,
  source: 'AI_RECOMMENDED',
  ...over,
});

const employee = (over: Record<string, unknown> = {}) => ({
  id: 'emp-1',
  orgId: 'org-1',
  name: 'Jane Doe',
  primaryRoles: ['Project Manager'],
  secondaryRoles: [],
  certifications: ['PMP', 'CSM'],
  location: 'ONSHORE',
  resumeRef: 'doc-cv-1',
  source: 'MANUAL',
  ...over,
});

const planWith = (members: PlanTeamMember[] | null) => ({
  id: 'plan-1',
  status: 'READY',
  planTeam: members ? { members, userModified: false } : null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSolutionPlanByOpportunity.mockResolvedValue(planWith([filledLine()]));
  mockListEmployeesByOrg.mockResolvedValue([employee()]);
  mockGetDocumentItemByDocumentId.mockResolvedValue({ id: 'doc-cv-1', textFileKey: 'text/cv-1.txt' });
  mockLoadTextFromS3.mockResolvedValue('Jane has 12 years of federal PM experience.');
});

// ─── classifyTeamLine (BR2.5) ─────────────────────────────────────────────────

describe('classifyTeamLine — BR2.5 detection order', () => {
  it('classifies the three declared shapes in the fixed order', () => {
    expect(classifyTeamLine(unfilledLine())).toBe('UNFILLED');
    expect(classifyTeamLine(deletedLine())).toBe('DELETED');
    expect(classifyTeamLine(filledLine())).toBe('FILLED');
  });

  it('flags an invalid shape (snapshot, no employeeId, not removed) with a warning', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const invalid: PlanTeamMember = {
      nameSnapshot: 'Odd Line',
      role: 'Analyst',
      removedEmployee: false,
      source: 'MANUAL',
    };
    expect(classifyTeamLine(invalid)).toBe('INVALID');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Data-integrity warning'));
    warnSpy.mockRestore();
  });
});

// ─── hasSavedTeam (BR1.1) ─────────────────────────────────────────────────────

describe('hasSavedTeam — BR1.1 saved-team precondition', () => {
  it('is false for no plan, no persisted team, and an empty member list', () => {
    expect(hasSavedTeam(null)).toBe(false);
    expect(hasSavedTeam(undefined)).toBe(false);
    expect(hasSavedTeam({ planTeam: null })).toBe(false);
    expect(hasSavedTeam({ planTeam: { members: [], userModified: false } })).toBe(false);
  });

  it('is true for any persisted team with a member — auto-attached teams qualify', () => {
    expect(
      hasSavedTeam({ planTeam: { members: [filledLine()], userModified: false } }),
    ).toBe(true);
  });
});

// ─── assembleTeamQualificationsContext ────────────────────────────────────────

describe('assembleTeamQualificationsContext', () => {
  it('returns null when the plan has no saved team (BR1.1)', async () => {
    mockGetSolutionPlanByOpportunity.mockResolvedValue(planWith(null));
    expect(await assembleTeamQualificationsContext(key)).toBeNull();

    mockGetSolutionPlanByOpportunity.mockResolvedValue(null);
    expect(await assembleTeamQualificationsContext(key)).toBeNull();

    expect(mockListEmployeesByOrg).not.toHaveBeenCalled();
  });

  it('cites a FILLED member with structured fields plus CV text (BR2.2)', async () => {
    const context = await assembleTeamQualificationsContext(key);

    expect(context).toEqual({
      opportunityId: 'opp-1',
      members: [
        {
          nameSnapshot: 'Jane Doe',
          role: 'Project Manager',
          certifications: ['PMP', 'CSM'],
          location: 'ONSHORE',
          rationale: 'PMP certified federal PM.',
          cvText: 'Jane has 12 years of federal PM experience.',
        },
      ],
      openRoles: [],
      pendingReplacements: [],
    });
    expect(mockListEmployeesByOrg).toHaveBeenCalledTimes(1);
    expect(mockLoadTextFromS3).toHaveBeenCalledWith('test-documents-bucket', 'text/cv-1.txt');
  });

  it('degrades to structured fields with a noted reason when the CV does not resolve (BR2.2)', async () => {
    mockGetDocumentItemByDocumentId.mockResolvedValue(undefined);

    const context = await assembleTeamQualificationsContext(key);

    expect(context?.members[0]).toMatchObject({
      nameSnapshot: 'Jane Doe',
      cvText: null,
      cvMissingReason: expect.stringContaining('does not resolve'),
    });
    expect(mockLoadTextFromS3).not.toHaveBeenCalled();
  });

  it('degrades to structured fields when the S3 read fails — assembly never fails (BR2.2)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockLoadTextFromS3.mockRejectedValue(new Error('S3 unavailable'));

    const context = await assembleTeamQualificationsContext(key);

    expect(context?.members[0]).toMatchObject({
      cvText: null,
      cvMissingReason: 'resume text could not be loaded',
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load CV text'));
    warnSpy.mockRestore();
  });

  it('notes a missing bio source when the employee has no resumeRef (BR2.2)', async () => {
    mockListEmployeesByOrg.mockResolvedValue([employee({ resumeRef: undefined })]);

    const context = await assembleTeamQualificationsContext(key);

    expect(context?.members[0]).toMatchObject({
      cvText: null,
      cvMissingReason: 'no resume/CV on file',
    });
    expect(mockGetDocumentItemByDocumentId).not.toHaveBeenCalled();
  });

  it('applies the per-member CV budget to oversized resumes', async () => {
    mockLoadTextFromS3.mockResolvedValue('x'.repeat(TEAM_MEMBER_CV_TEXT_BUDGET + 500));

    const context = await assembleTeamQualificationsContext(key);

    expect(context?.members[0]?.cvText).toHaveLength(TEAM_MEMBER_CV_TEXT_BUDGET);
  });

  it('populates openRoles and pendingReplacements for UNFILLED and DELETED lines (BR2.3)', async () => {
    mockGetSolutionPlanByOpportunity.mockResolvedValue(
      planWith([filledLine(), deletedLine(), unfilledLine()]),
    );

    const context = await assembleTeamQualificationsContext(key);

    expect(context?.members).toHaveLength(1);
    expect(context?.openRoles).toEqual(['Cloud Architect']);
    expect(context?.pendingReplacements).toEqual([
      { nameSnapshot: 'Gone Person', role: 'Senior Engineer' },
    ]);
  });

  it('degrades a stale FILLED reference to pending replacement with a data-integrity warning (BR2.5)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetSolutionPlanByOpportunity.mockResolvedValue(
      planWith([filledLine({ employeeId: 'emp-vanished', nameSnapshot: 'Stale Ref' })]),
    );

    const context = await assembleTeamQualificationsContext(key);

    expect(context?.members).toHaveLength(0);
    expect(context?.pendingReplacements).toEqual([
      { nameSnapshot: 'Stale Ref', role: 'Project Manager' },
    ]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Data-integrity warning'));
    warnSpy.mockRestore();
  });

  it('cites an invalid-shape line as pending replacement rather than dropping it (BR2.5)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetSolutionPlanByOpportunity.mockResolvedValue(
      planWith([
        {
          nameSnapshot: 'Odd Line',
          role: 'Analyst',
          removedEmployee: false,
          source: 'MANUAL',
        },
      ]),
    );

    const context = await assembleTeamQualificationsContext(key);

    expect(context?.pendingReplacements).toEqual([{ nameSnapshot: 'Odd Line', role: 'Analyst' }]);
    warnSpy.mockRestore();
  });
});

// ─── renderTeamContextBlock ───────────────────────────────────────────────────

describe('renderTeamContextBlock', () => {
  const baseContext: TeamQualificationsContext = {
    opportunityId: 'opp-1',
    members: [
      {
        nameSnapshot: 'Jane Doe',
        role: 'Project Manager',
        certifications: ['PMP'],
        location: 'ONSHORE',
        rationale: 'Strong match.',
        cvText: 'Federal PM background.',
      },
      {
        nameSnapshot: 'No Bio',
        role: 'Engineer',
        certifications: [],
        cvText: null,
        cvMissingReason: 'no resume/CV on file',
      },
    ],
    openRoles: ['Cloud Architect'],
    pendingReplacements: [{ nameSnapshot: 'Gone Person', role: 'Senior Engineer' }],
  };

  it('renders filled members, open roles, and pending replacements with their handling rules', () => {
    const block = renderTeamContextBlock(baseContext);

    expect(block).toContain('SAVED TEAM ROSTER (opportunity opp-1)');
    expect(block).toContain('1. Jane Doe — Project Manager');
    expect(block).toContain('Certifications: PMP');
    expect(block).toContain('Federal PM background.');
    expect(block).toContain('Resume/CV: not available (no resume/CV on file)');
    expect(block).toContain('OPEN ROLES');
    expect(block).toContain('- Cloud Architect');
    expect(block).toContain('PENDING REPLACEMENT');
    expect(block).toContain('- Gone Person — Senior Engineer');
  });

  it('truncates the rendered block to the total budget with a warning', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const oversized: TeamQualificationsContext = {
      ...baseContext,
      members: Array.from({ length: 12 }, (_, i) => ({
        nameSnapshot: `Person ${i}`,
        role: 'Engineer',
        certifications: [],
        cvText: 'y'.repeat(TEAM_MEMBER_CV_TEXT_BUDGET),
      })),
    };

    const block = renderTeamContextBlock(oversized);

    expect(block).toHaveLength(TEAM_CONTEXT_TEXT_BUDGET);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('truncated'));
    warnSpy.mockRestore();
  });
});

/**
 * The two gates are composed here, so the leaf reads are mocked and the real
 * `checkSolutionPlanGate` + `checkKBCoverageGate` bodies run. That is what lets
 * these tests assert on *how many* reads a refusal costs, which is the
 * no-added-latency acceptance criterion.
 */
const mockGetOrganizationById = jest.fn();
jest.mock('@/helpers/org', () => ({
  getOrganizationById: (...a: unknown[]) => mockGetOrganizationById(...a),
}));

const mockGetPlan = jest.fn();
jest.mock('@/helpers/solution-plan', () => ({
  getSolutionPlanByOpportunity: (...a: unknown[]) => mockGetPlan(...a),
}));

const mockListDocs = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  listRFPDocumentsByProject: (...a: unknown[]) => mockListDocs(...a),
}));

// db.ts / company-profile.ts read these at import time; the real probe never
// runs here, but requiring the actual module pulls them in.
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

// Only the probe is stubbed. The env + org-flag helpers stay real so the
// escape-hatch assertions below exercise the shipped logic, not a copy of it.
const mockComputeSnapshot = jest.fn();
jest.mock('@/helpers/kb-coverage', () => ({
  ...jest.requireActual('@/helpers/kb-coverage'),
  computeKBCoverageSnapshot: (...a: unknown[]) => mockComputeSnapshot(...a),
}));

import { checkGenerationPreconditions, checkKBCoverageGate } from './generation-preconditions';

const key = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };

/** TEAM_QUALIFICATIONS requires PERSONNEL_BIOS + CERTIFICATIONS. */
const gatedArgs = { ...key, documentType: 'TEAM_QUALIFICATIONS' };

const covered = {
  PERSONNEL_BIOS: { present: true, count: 2 },
  CERTIFICATIONS: { present: true, count: 1 },
};

const uncovered = {
  PERSONNEL_BIOS: { present: false, count: 0 },
  CERTIFICATIONS: { present: false, count: 0 },
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SOLUTION_PLAN_GATING;
  delete process.env.KB_COVERAGE_GATING;
  // Defaults: both flags on, plan READY, KB fully covered → both gates open.
  mockGetOrganizationById.mockResolvedValue({
    id: 'org-1',
    enableSolutionPlan: true,
    enableKBCoverageGate: true,
  });
  mockGetPlan.mockResolvedValue({ status: 'READY' });
  mockListDocs.mockResolvedValue({ items: [], nextToken: null });
  mockComputeSnapshot.mockResolvedValue(covered);
});

afterAll(() => {
  delete process.env.SOLUTION_PLAN_GATING;
  delete process.env.KB_COVERAGE_GATING;
});

describe('checkKBCoverageGate', () => {
  it('should open with zero reads for a document type with no KB requirements', async () => {
    const result = await checkKBCoverageGate({ orgId: 'org-1', documentType: 'TECHNICAL_PROPOSAL' });

    expect(result).toEqual({ allowed: true, missingCategories: [] });
    expect(mockGetOrganizationById).not.toHaveBeenCalled();
    expect(mockComputeSnapshot).not.toHaveBeenCalled();
  });

  it('should open with zero reads for an unmapped custom document type', async () => {
    const result = await checkKBCoverageGate({ orgId: 'org-1', documentType: 'MY_CUSTOM_TYPE' });

    expect(result.allowed).toBe(true);
    expect(mockComputeSnapshot).not.toHaveBeenCalled();
  });

  it('should open without reads when KB_COVERAGE_GATING=off', async () => {
    process.env.KB_COVERAGE_GATING = 'off';
    mockComputeSnapshot.mockResolvedValue(uncovered);

    const result = await checkKBCoverageGate({
      orgId: 'org-1',
      documentType: 'TEAM_QUALIFICATIONS',
    });

    expect(result.allowed).toBe(true);
    expect(mockGetOrganizationById).not.toHaveBeenCalled();
    expect(mockComputeSnapshot).not.toHaveBeenCalled();
  });

  it('should open without probing when the org flag is off', async () => {
    // The default: warn in the UI, never block.
    mockGetOrganizationById.mockResolvedValue({ id: 'org-1' });
    mockComputeSnapshot.mockResolvedValue(uncovered);

    const result = await checkKBCoverageGate({
      orgId: 'org-1',
      documentType: 'TEAM_QUALIFICATIONS',
    });

    expect(result.allowed).toBe(true);
    expect(mockComputeSnapshot).not.toHaveBeenCalled();
  });

  it('should open when the org record is missing', async () => {
    mockGetOrganizationById.mockResolvedValue(null);

    const result = await checkKBCoverageGate({
      orgId: 'org-1',
      documentType: 'TEAM_QUALIFICATIONS',
    });

    expect(result.allowed).toBe(true);
  });

  it('should probe only the categories the document type requires', async () => {
    await checkKBCoverageGate({ orgId: 'org-1', documentType: 'TEAM_QUALIFICATIONS' });

    expect(mockComputeSnapshot).toHaveBeenCalledWith('org-1', [
      'PERSONNEL_BIOS',
      'CERTIFICATIONS',
    ]);
  });

  it('should open when every required category is present', async () => {
    const result = await checkKBCoverageGate({
      orgId: 'org-1',
      documentType: 'TEAM_QUALIFICATIONS',
    });

    expect(result).toEqual({ allowed: true, missingCategories: [] });
  });

  it('should refuse and name every missing category', async () => {
    mockComputeSnapshot.mockResolvedValue(uncovered);

    const result = await checkKBCoverageGate({
      orgId: 'org-1',
      documentType: 'TEAM_QUALIFICATIONS',
    });

    expect(result).toEqual({
      allowed: false,
      missingCategories: [
        { key: 'PERSONNEL_BIOS', label: 'personnel bios' },
        { key: 'CERTIFICATIONS', label: 'certification records' },
      ],
    });
  });

  it('should name only the categories that are actually absent', async () => {
    mockComputeSnapshot.mockResolvedValue({
      PERSONNEL_BIOS: { present: true, count: 1 },
      CERTIFICATIONS: { present: false, count: 0 },
    });

    const result = await checkKBCoverageGate({
      orgId: 'org-1',
      documentType: 'TEAM_QUALIFICATIONS',
    });

    expect(result.missingCategories).toEqual([
      { key: 'CERTIFICATIONS', label: 'certification records' },
    ]);
  });

  it('should use the shared org loader instead of reading the org itself', async () => {
    const loadOrg = jest.fn().mockResolvedValue({ id: 'org-1', enableKBCoverageGate: true });

    await checkKBCoverageGate({ orgId: 'org-1', documentType: 'TEAM_QUALIFICATIONS', loadOrg });

    expect(loadOrg).toHaveBeenCalledTimes(1);
    expect(mockGetOrganizationById).not.toHaveBeenCalled();
  });
});

describe('checkGenerationPreconditions', () => {
  it('should allow generation when both preconditions are satisfied', async () => {
    expect(await checkGenerationPreconditions(gatedArgs)).toEqual({ allowed: true });
  });

  it('should read the org exactly once across both gates', async () => {
    await checkGenerationPreconditions(gatedArgs);

    // Composing the gates must not double the GetItem.
    expect(mockGetOrganizationById).toHaveBeenCalledTimes(1);
    expect(mockGetOrganizationById).toHaveBeenCalledWith('org-1');
  });

  it('should refuse with the byte-identical T9 body when no ready plan exists', async () => {
    mockGetPlan.mockResolvedValue(null);

    const result = await checkGenerationPreconditions(gatedArgs);

    expect(result).toEqual({
      allowed: false,
      refusal: {
        code: 'SOLUTION_PLAN_REQUIRED',
        message:
          'A ready Solution Plan is required before generating this document type. Create a Solution Plan for this opportunity first.',
        solutionPlanStatus: null,
      },
    });
  });

  it('should carry the plan status through the refusal', async () => {
    mockGetPlan.mockResolvedValue({ status: 'GRILLING' });

    const result = await checkGenerationPreconditions(gatedArgs);

    expect(result).toMatchObject({ refusal: { solutionPlanStatus: 'GRILLING' } });
  });

  it('should let a plan refusal short-circuit the coverage probe', async () => {
    // A plan refusal must cost zero coverage reads.
    mockGetPlan.mockResolvedValue(null);
    mockComputeSnapshot.mockResolvedValue(uncovered);

    const result = await checkGenerationPreconditions(gatedArgs);

    expect(result).toMatchObject({ allowed: false });
    expect(mockComputeSnapshot).not.toHaveBeenCalled();
  });

  it('should refuse with the named missing categories when coverage is incomplete', async () => {
    mockComputeSnapshot.mockResolvedValue(uncovered);

    const result = await checkGenerationPreconditions(gatedArgs);

    expect(result).toEqual({
      allowed: false,
      refusal: {
        code: 'KB_COVERAGE_INCOMPLETE',
        message: expect.stringContaining('personnel bios'),
        missingCategories: [
          { key: 'PERSONNEL_BIOS', label: 'personnel bios' },
          { key: 'CERTIFICATIONS', label: 'certification records' },
        ],
      },
    });
    expect(result).toMatchObject({
      refusal: { message: expect.stringContaining('certification records') },
    });
  });

  it('should prefer the plan refusal when both preconditions fail', async () => {
    mockGetPlan.mockResolvedValue(null);
    mockComputeSnapshot.mockResolvedValue(uncovered);

    const result = await checkGenerationPreconditions(gatedArgs);

    expect(result).toMatchObject({ refusal: { code: 'SOLUTION_PLAN_REQUIRED' } });
  });

  it('should not block a coverage-mapped type when the coverage flag is off but the plan gate passes', async () => {
    mockGetOrganizationById.mockResolvedValue({ id: 'org-1', enableSolutionPlan: true });
    mockComputeSnapshot.mockResolvedValue(uncovered);

    expect(await checkGenerationPreconditions(gatedArgs)).toEqual({ allowed: true });
  });

  it('should read nothing at all for a plan-exempt, coverage-unmapped type', async () => {
    const result = await checkGenerationPreconditions({
      ...key,
      documentType: 'CLARIFYING_QUESTIONS',
    });

    expect(result).toEqual({ allowed: true });
    expect(mockGetOrganizationById).not.toHaveBeenCalled();
    expect(mockGetPlan).not.toHaveBeenCalled();
    expect(mockComputeSnapshot).not.toHaveBeenCalled();
  });

  it('should still enforce coverage on an opportunity grandfathered past the plan gate', async () => {
    // Grandfathering is deliberately plan-only: an old generated document says
    // nothing about whether the KB holds personnel data now.
    mockGetPlan.mockResolvedValue(null);
    mockListDocs.mockResolvedValue({
      items: [{ documentType: 'TECHNICAL_PROPOSAL', htmlContentKey: 'k1' }],
      nextToken: null,
    });
    mockComputeSnapshot.mockResolvedValue(uncovered);

    const result = await checkGenerationPreconditions(gatedArgs);

    expect(result).toMatchObject({ refusal: { code: 'KB_COVERAGE_INCOMPLETE' } });
  });

  it('should not probe coverage for a document type with no KB requirements', async () => {
    const result = await checkGenerationPreconditions({
      ...key,
      documentType: 'TECHNICAL_PROPOSAL',
    });

    expect(result).toEqual({ allowed: true });
    expect(mockComputeSnapshot).not.toHaveBeenCalled();
  });
});

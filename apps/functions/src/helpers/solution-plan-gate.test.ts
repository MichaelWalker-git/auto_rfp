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

import {
  GATE_EXEMPT_DOCUMENT_TYPES,
  checkSolutionPlanGate,
  isGatedDocumentType,
} from './solution-plan-gate';

const key = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const args = { ...key, documentType: 'COST_PROPOSAL' };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SOLUTION_PLAN_GATING;
  // Defaults: flag on, no plan, no existing documents — the gate blocks
  mockGetOrganizationById.mockResolvedValue({ id: 'org-1', enableSolutionPlan: true });
  mockGetPlan.mockResolvedValue(null);
  mockListDocs.mockResolvedValue({ items: [], nextToken: null });
});

afterAll(() => {
  delete process.env.SOLUTION_PLAN_GATING;
});

describe('isGatedDocumentType', () => {
  it.each(GATE_EXEMPT_DOCUMENT_TYPES)('exempts %s', (documentType) => {
    expect(isGatedDocumentType(documentType)).toBe(false);
  });

  it('gates proposal document types and custom types', () => {
    expect(isGatedDocumentType('COST_PROPOSAL')).toBe(true);
    expect(isGatedDocumentType('TECHNICAL_PROPOSAL')).toBe(true);
    expect(isGatedDocumentType('MY_CUSTOM_TYPE')).toBe(true);
  });
});

describe('checkSolutionPlanGate', () => {
  it('blocks a gated type when no plan exists', async () => {
    const result = await checkSolutionPlanGate(args);
    expect(result).toEqual({ allowed: false, solutionPlanStatus: null });
    expect(mockGetPlan).toHaveBeenCalledWith(key);
  });

  it('blocks with the plan status when the plan is not READY', async () => {
    mockGetPlan.mockResolvedValue({ status: 'GRILLING' });
    const result = await checkSolutionPlanGate(args);
    expect(result).toEqual({ allowed: false, solutionPlanStatus: 'GRILLING' });
  });

  it('passes when the plan is READY', async () => {
    mockGetPlan.mockResolvedValue({ status: 'READY', isStale: false });
    const result = await checkSolutionPlanGate(args);
    expect(result).toEqual({ allowed: true, solutionPlanStatus: 'READY' });
    expect(mockListDocs).not.toHaveBeenCalled();
  });

  it('passes when the plan is READY but stale — isStale does not close the gate', async () => {
    mockGetPlan.mockResolvedValue({ status: 'READY', isStale: true, staleReason: 'brief regenerated' });
    const result = await checkSolutionPlanGate(args);
    expect(result).toEqual({ allowed: true, solutionPlanStatus: 'READY' });
  });

  it.each(GATE_EXEMPT_DOCUMENT_TYPES)('passes exempt type %s without any lookups', async (documentType) => {
    const result = await checkSolutionPlanGate({ ...key, documentType });
    expect(result.allowed).toBe(true);
    expect(mockGetOrganizationById).not.toHaveBeenCalled();
    expect(mockGetPlan).not.toHaveBeenCalled();
  });

  it('passes when SOLUTION_PLAN_GATING=off without any lookups', async () => {
    process.env.SOLUTION_PLAN_GATING = 'off';
    const result = await checkSolutionPlanGate(args);
    expect(result.allowed).toBe(true);
    expect(mockGetOrganizationById).not.toHaveBeenCalled();
    expect(mockGetPlan).not.toHaveBeenCalled();
  });

  it('passes when the org flag is off', async () => {
    mockGetOrganizationById.mockResolvedValue({ id: 'org-1' });
    const result = await checkSolutionPlanGate(args);
    expect(result.allowed).toBe(true);
    expect(mockGetPlan).not.toHaveBeenCalled();
  });

  it('passes when the org record is missing (flag defaults to off)', async () => {
    mockGetOrganizationById.mockResolvedValue(null);
    const result = await checkSolutionPlanGate(args);
    expect(result.allowed).toBe(true);
  });

  it('grandfathers when the opportunity already has a gated-type document', async () => {
    mockListDocs.mockResolvedValue({
      items: [{ documentType: 'TECHNICAL_PROPOSAL' }],
      nextToken: null,
    });
    const result = await checkSolutionPlanGate(args);
    expect(result).toEqual({ allowed: true, solutionPlanStatus: null });
    expect(mockListDocs).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1', opportunityId: 'opp-1' }),
    );
  });

  it('does not grandfather off exempt-type documents', async () => {
    mockListDocs.mockResolvedValue({
      items: [{ documentType: 'CLARIFYING_QUESTIONS' }, { documentType: 'QUESTIONNAIRE' }],
      nextToken: null,
    });
    const result = await checkSolutionPlanGate(args);
    expect(result.allowed).toBe(false);
  });

  it('paginates the document list when checking for grandfathered documents', async () => {
    mockListDocs
      .mockResolvedValueOnce({
        items: [{ documentType: 'QUESTIONS_AND_ANSWERS' }],
        nextToken: { pk: 'x' },
      })
      .mockResolvedValueOnce({
        items: [{ documentType: 'COVER_LETTER' }],
        nextToken: null,
      });
    const result = await checkSolutionPlanGate(args);
    expect(result.allowed).toBe(true);
    expect(mockListDocs).toHaveBeenCalledTimes(2);
    expect(mockListDocs).toHaveBeenLastCalledWith(
      expect.objectContaining({ nextToken: { pk: 'x' } }),
    );
  });

  it('does not count documents without a documentType', async () => {
    mockListDocs.mockResolvedValue({ items: [{ name: 'legacy doc' }], nextToken: null });
    const result = await checkSolutionPlanGate(args);
    expect(result.allowed).toBe(false);
  });

  it('does not grandfather off uploaded gated-type documents', async () => {
    mockListDocs.mockResolvedValue({
      items: [
        { documentType: 'NDA', fileKey: 'org-1/proj-1/opp-1/rfp-documents/d1/v1/nda.pdf' },
        { documentType: 'TECHNICAL_PROPOSAL', originalFileName: 'old-proposal.docx' },
      ],
      nextToken: null,
    });
    const result = await checkSolutionPlanGate(args);
    expect(result.allowed).toBe(false);
  });

  it('grandfathers off generated documents with null file fields', async () => {
    mockListDocs.mockResolvedValue({
      items: [{ documentType: 'COST_PROPOSAL', fileKey: null, originalFileName: null }],
      nextToken: null,
    });
    const result = await checkSolutionPlanGate(args);
    expect(result.allowed).toBe(true);
  });
});

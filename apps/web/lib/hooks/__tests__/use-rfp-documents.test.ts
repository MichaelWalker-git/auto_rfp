import {
  ApiError,
  KBCoverageIncompleteError,
  SolutionPlanRequiredError,
  isKBCoverageIncompleteError,
  isSolutionPlanRequiredError,
  toGenerateDocumentError,
} from '../use-rfp-documents';

jest.mock('@/lib/env', () => ({ env: { BASE_API_URL: 'https://api.test' } }));
jest.mock('@/lib/auth/auth-fetcher', () => ({ authFetcher: jest.fn() }));

describe('toGenerateDocumentError', () => {
  it('maps a 409 SOLUTION_PLAN_REQUIRED body to SolutionPlanRequiredError', () => {
    const raw = new ApiError(
      JSON.stringify({
        message: 'A ready Solution Plan is required.',
        code: 'SOLUTION_PLAN_REQUIRED',
        solutionPlanStatus: 'GRILLING',
      }),
      409,
    );

    const mapped = toGenerateDocumentError(raw);

    expect(isSolutionPlanRequiredError(mapped)).toBe(true);
    const err = mapped as SolutionPlanRequiredError;
    expect(err.message).toBe('A ready Solution Plan is required.');
    expect(err.status).toBe(409);
    expect(err.solutionPlanStatus).toBe('GRILLING');
  });

  it('falls back to a default message when the body has none', () => {
    const raw = new ApiError(
      JSON.stringify({ code: 'SOLUTION_PLAN_REQUIRED', solutionPlanStatus: null }),
      409,
    );

    const mapped = toGenerateDocumentError(raw) as SolutionPlanRequiredError;

    expect(isSolutionPlanRequiredError(mapped)).toBe(true);
    expect(mapped.message).toContain('Solution Plan');
    expect(mapped.solutionPlanStatus).toBeNull();
  });

  it('degrades an unrecognized solutionPlanStatus to null instead of passing through', () => {
    const raw = new ApiError(
      JSON.stringify({ code: 'SOLUTION_PLAN_REQUIRED', solutionPlanStatus: 'BOGUS' }),
      409,
    );

    const mapped = toGenerateDocumentError(raw) as SolutionPlanRequiredError;

    expect(isSolutionPlanRequiredError(mapped)).toBe(true);
    expect(mapped.solutionPlanStatus).toBeNull();
  });

  it('maps a 409 KB_COVERAGE_INCOMPLETE body to KBCoverageIncompleteError with the named gaps', () => {
    const raw = new ApiError(
      JSON.stringify({
        code: 'KB_COVERAGE_INCOMPLETE',
        message:
          'The knowledge base is missing content this document type requires: personnel bios, certification records.',
        missingCategories: [
          { key: 'PERSONNEL_BIOS', label: 'personnel bios' },
          { key: 'CERTIFICATIONS', label: 'certification records' },
        ],
      }),
      409,
    );

    const mapped = toGenerateDocumentError(raw);

    expect(isKBCoverageIncompleteError(mapped)).toBe(true);
    // The two refusals must stay distinguishable — one gate, two precondition types.
    expect(isSolutionPlanRequiredError(mapped)).toBe(false);
    const err = mapped as KBCoverageIncompleteError;
    expect(err.status).toBe(409);
    expect(err.message).toContain('personnel bios');
    expect(err.message).toContain('certification records');
    expect(err.missingCategories.map((c) => c.label)).toEqual([
      'personnel bios',
      'certification records',
    ]);
  });

  it('builds the named message itself when the coverage body carries an empty one', () => {
    const raw = new ApiError(
      JSON.stringify({
        code: 'KB_COVERAGE_INCOMPLETE',
        message: '',
        missingCategories: [{ key: 'INSURANCE', label: 'insurance documents' }],
      }),
      409,
    );

    const mapped = toGenerateDocumentError(raw) as KBCoverageIncompleteError;

    expect(isKBCoverageIncompleteError(mapped)).toBe(true);
    expect(mapped.message).toContain('insurance documents');
  });

  it('passes through 409s with other codes', () => {
    const raw = new ApiError(JSON.stringify({ code: 'SOLUTION_PLAN_CONFLICT' }), 409);
    expect(toGenerateDocumentError(raw)).toBe(raw);
  });

  it('passes through non-409 and non-JSON errors unchanged', () => {
    const notFound = new ApiError('Not found', 404);
    expect(toGenerateDocumentError(notFound)).toBe(notFound);

    const nonJson = new ApiError('<html>gateway timeout</html>', 409);
    expect(toGenerateDocumentError(nonJson)).toBe(nonJson);

    const plain = new Error('network down');
    expect(toGenerateDocumentError(plain)).toBe(plain);
  });
});

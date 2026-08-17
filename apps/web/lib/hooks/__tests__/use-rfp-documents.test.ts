import {
  ApiError,
  SolutionPlanRequiredError,
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

  it('maps a 409 SOLUTION_PLAN_NO_BID body and carries the code', () => {
    const raw = new ApiError(
      JSON.stringify({
        message: 'The Solution Plan for this opportunity is a NO-BID decision — document generation is blocked.',
        code: 'SOLUTION_PLAN_NO_BID',
        solutionPlanStatus: 'READY',
      }),
      409,
    );

    const mapped = toGenerateDocumentError(raw);

    expect(isSolutionPlanRequiredError(mapped)).toBe(true);
    const err = mapped as SolutionPlanRequiredError;
    expect(err.code).toBe('SOLUTION_PLAN_NO_BID');
    expect(err.solutionPlanStatus).toBe('READY');
    expect(err.message).toContain('NO-BID');
  });

  it('falls back to a No-Bid default message when the NO_BID body has none', () => {
    const raw = new ApiError(
      JSON.stringify({ code: 'SOLUTION_PLAN_NO_BID', solutionPlanStatus: 'READY' }),
      409,
    );

    const mapped = toGenerateDocumentError(raw) as SolutionPlanRequiredError;

    expect(isSolutionPlanRequiredError(mapped)).toBe(true);
    expect(mapped.code).toBe('SOLUTION_PLAN_NO_BID');
    expect(mapped.message).toContain('No-Bid');
  });

  it('defaults the carried code to SOLUTION_PLAN_REQUIRED for required bodies', () => {
    const raw = new ApiError(
      JSON.stringify({ code: 'SOLUTION_PLAN_REQUIRED', solutionPlanStatus: null }),
      409,
    );

    const mapped = toGenerateDocumentError(raw) as SolutionPlanRequiredError;

    expect(mapped.code).toBe('SOLUTION_PLAN_REQUIRED');
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

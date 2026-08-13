import { getSaveErrorDescription } from '../save-errors';

const apiError = (over: { message?: string; status?: number; details?: unknown } = {}) =>
  Object.assign(new Error(over.message ?? 'Request failed'), over);

describe('getSaveErrorDescription', () => {
  it('maps the 409 not-READY refusal to the run-in-progress hint (ADR-8)', () => {
    const description = getSaveErrorDescription(
      apiError({ status: 409, details: { code: 'SOLUTION_PLAN_NOT_READY' } }),
    );
    expect(description).toMatch(/not editable right now/i);
  });

  it('maps the 409 version conflict to the reload hint (ADR-11)', () => {
    const description = getSaveErrorDescription(
      apiError({ status: 409, details: { code: 'SOLUTION_PLAN_CONFLICT' } }),
    );
    expect(description).toMatch(/changed while you were editing/i);
  });

  it('falls back to the API message for a 409 with an unmapped code', () => {
    const description = getSaveErrorDescription(
      apiError({
        message: 'A run is already in progress',
        status: 409,
        details: { code: 'SOLUTION_PLAN_RUN_IN_PROGRESS' },
      }),
    );
    expect(description).toBe('A run is already in progress');
  });

  it('falls back to the API message for non-409 errors, ignoring any code', () => {
    const description = getSaveErrorDescription(
      apiError({ message: 'Forbidden', status: 403, details: { code: 'SOLUTION_PLAN_CONFLICT' } }),
    );
    expect(description).toBe('Forbidden');
  });

  it('falls back to the API message when the 409 body has no known code', () => {
    const description = getSaveErrorDescription(
      apiError({ message: 'Conflict', status: 409, details: { reason: 'unknown' } }),
    );
    expect(description).toBe('Conflict');
  });

  it('returns the generic description for values that are not error-shaped', () => {
    expect(getSaveErrorDescription(undefined)).toMatch(/could not save/i);
    expect(getSaveErrorDescription('boom')).toMatch(/could not save/i);
    expect(getSaveErrorDescription(apiError({ message: '' }))).toMatch(/could not save/i);
  });
});

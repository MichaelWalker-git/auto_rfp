import { errorMessageOf, NotFoundError, isNotFoundError } from './error';

describe('errorMessageOf', () => {
  it('returns the message of an Error instance', () => {
    expect(errorMessageOf(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-Error throwables', () => {
    expect(errorMessageOf('plain string')).toBe('plain string');
    expect(errorMessageOf(42)).toBe('42');
    expect(errorMessageOf(undefined)).toBe('undefined');
  });
});

describe('NotFoundError / isNotFoundError', () => {
  it('is an Error subclass that preserves the message and name', () => {
    const err = new NotFoundError('Form not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Form not found');
    expect(err.name).toBe('NotFoundError');
  });

  it('identifies a NotFoundError', () => {
    expect(isNotFoundError(new NotFoundError('x'))).toBe(true);
  });

  it('matches by name even without instanceof (cross-bundle safety)', () => {
    // Simulate a NotFoundError that crossed a module boundary (different class
    // identity) — the name-based fallback must still classify it as 404.
    const crossBundle = Object.assign(new Error('gone'), { name: 'NotFoundError' });
    expect(isNotFoundError(crossBundle)).toBe(true);
  });

  it('does NOT classify a generic error, even if the message says "not found"', () => {
    expect(isNotFoundError(new Error('table not found'))).toBe(false);
    expect(isNotFoundError('not found')).toBe(false);
    expect(isNotFoundError(null)).toBe(false);
  });
});

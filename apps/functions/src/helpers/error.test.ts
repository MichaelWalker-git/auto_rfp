import { errorMessageOf } from './error';

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

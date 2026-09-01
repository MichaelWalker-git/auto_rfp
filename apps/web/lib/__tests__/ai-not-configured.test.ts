import {
  AI_NOT_CONFIGURED_CODE,
  isAiNotConfiguredError,
} from '../ai-not-configured';

describe('isAiNotConfiguredError', () => {
  it('detects a web typed error carrying the code directly', () => {
    expect(isAiNotConfiguredError({ code: AI_NOT_CONFIGURED_CODE, status: 409 })).toBe(true);
  });

  it('detects the shared ApiError with the parsed body in .details', () => {
    expect(
      isAiNotConfiguredError({
        status: 409,
        details: { code: AI_NOT_CONFIGURED_CODE, message: 'AI is not configured' },
      }),
    ).toBe(true);
  });

  it('detects a feature-local ApiError whose .message holds the raw JSON body', () => {
    const message = JSON.stringify({ code: AI_NOT_CONFIGURED_CODE, message: 'nope' });
    expect(isAiNotConfiguredError({ status: 409, message })).toBe(true);
  });

  it('detects a plain Error whose message contains the sentinel code', () => {
    expect(isAiNotConfiguredError(new Error(AI_NOT_CONFIGURED_CODE))).toBe(true);
  });

  it('returns false for an unrelated error', () => {
    expect(isAiNotConfiguredError(new Error('Bedrock timeout'))).toBe(false);
    expect(isAiNotConfiguredError({ status: 500, details: { code: 'OTHER' } })).toBe(false);
  });

  it('returns false for non-object / nullish values', () => {
    expect(isAiNotConfiguredError(null)).toBe(false);
    expect(isAiNotConfiguredError(undefined)).toBe(false);
    expect(isAiNotConfiguredError('AI_NOT_CONFIGURED')).toBe(false);
  });
});

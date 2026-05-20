jest.mock('@sentry/serverless', () => ({
  AWSLambda: {
    init: jest.fn(),
    wrapHandler: jest.fn((h) => h),
  },
  setTag: jest.fn(),
}));

describe('sentry-lambda beforeSend filter', () => {
  let beforeSend: (event: Record<string, unknown>, hint: Record<string, unknown>) => Record<string, unknown> | null;

  beforeAll(() => {
    process.env.SENTRY_DSN = 'https://fake@sentry.io/123';
    jest.resetModules();
    const Sentry = jest.requireMock('@sentry/serverless');
    require('./sentry-lambda');
    beforeSend = Sentry.AWSLambda.init.mock.calls[0][0].beforeSend;
  });

  afterAll(() => {
    delete process.env.SENTRY_DSN;
  });

  it('drops BusinessRetryError', () => {
    const error = new Error('retry');
    error.name = 'BusinessRetryError';
    const result = beforeSend({ message: 'test' }, { originalException: error });
    expect(result).toBeNull();
  });

  it('drops TransientServiceError', () => {
    const error = new Error('500');
    error.name = 'TransientServiceError';
    const result = beforeSend({ message: 'test' }, { originalException: error });
    expect(result).toBeNull();
  });

  it('drops timeout warnings for AnswerGen lambdas', () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'AutoRfp-AnswerGenPipeline-GenerateAnswerLambdaXYZ';
    const result = beforeSend(
      { message: 'Possible function timeout: AutoRfp-AnswerGenPipeline-GenerateAnswerLambdaXYZ', tags: { timeout: '5m' } },
      {},
    );
    expect(result).toBeNull();
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  });

  it('drops timeout warnings for search opportunities lambdas', () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'ApiOrchestrator-Dev-Searc-postsearchopportunitiess-abc123';
    const result = beforeSend(
      { message: 'Possible function timeout: ApiOrchestrator-Dev-Searc-postsearchopportunitiess-abc123', tags: { timeout: '30s' } },
      {},
    );
    expect(result).toBeNull();
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  });

  it('keeps timeout warnings for other lambdas', () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'ApiOrchestrator-Dev-Users-createuser-xyz';
    const event = { message: 'Possible function timeout: ApiOrchestrator-Dev-Users-createuser-xyz', tags: { timeout: '30s' } };
    const result = beforeSend(event, {});
    expect(result).toEqual(event);
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  });

  it('passes through normal errors', () => {
    const event = { message: 'Something broke' };
    const result = beforeSend(event, { originalException: new Error('oops') });
    expect(result).toEqual(event);
  });
});

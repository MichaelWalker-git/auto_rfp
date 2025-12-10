import * as Sentry from '@sentry/serverless';

Sentry.AWSLambda.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  tracesSampleRate: 1.0,
});

Sentry.setTag('service', 'backend');

export const withSentryLambda = Sentry.AWSLambda.wrapHandler;
export { Sentry };

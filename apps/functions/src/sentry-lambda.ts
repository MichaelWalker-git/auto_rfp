import * as Sentry from '@sentry/serverless';

const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';
const isProduction = environment === 'production';

Sentry.AWSLambda.init({
  dsn: process.env.SENTRY_DSN,
  environment,

  // Performance monitoring - adjust based on environment
  tracesSampleRate: isProduction ? 0.2 : 1.0,

  // Enable profiling for Lambda functions
  profilesSampleRate: isProduction ? 0.1 : 0.5,

  // Enable sending PII for better debugging
  sendDefaultPii: true,
});

Sentry.setTag('service', 'backend');

export const withSentryLambda = Sentry.AWSLambda.wrapHandler;
export { Sentry };

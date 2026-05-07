import * as Sentry from '@sentry/serverless';

const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';
const isProduction = environment === 'production';
const sentryEnabled = !!process.env.SENTRY_DSN;

/**
 * Business-level retry error — thrown to trigger SQS reprocessing
 * but intentionally excluded from Sentry error reporting.
 */
export class BusinessRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessRetryError';
  }
}

/**
 * Transient infrastructure error — thrown on temporary upstream failures
 * (e.g., Bedrock 500). Triggers SQS retry but excluded from Sentry.
 */
export class TransientServiceError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TransientServiceError';
    this.statusCode = statusCode;
  }
}

if (sentryEnabled) {
  Sentry.AWSLambda.init({
    dsn: process.env.SENTRY_DSN,
    environment,

    tracesSampleRate: isProduction ? 0.2 : 1.0,
    profilesSampleRate: isProduction ? 0.1 : 0.5,
    sendDefaultPii: true,

    beforeSend(event, hint) {
      const error = hint?.originalException;
      if (error instanceof Error) {
        if (error.name === 'BusinessRetryError' || error.name === 'TransientServiceError') {
          return null;
        }
      }
      return event;
    },
  });

  Sentry.setTag('service', 'backend');
}

export const withSentryLambda: typeof Sentry.AWSLambda.wrapHandler = sentryEnabled
  ? Sentry.AWSLambda.wrapHandler
  : ((handler) => handler) as typeof Sentry.AWSLambda.wrapHandler;

export { Sentry };

// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'development';
const isProduction = environment === 'production';

// Session replay rates: higher in dev/staging for better debugging, lower in production
const replaysSessionSampleRate = isProduction ? 0.1 : 0.5;
const tracesSampleRate = isProduction ? 0.2 : 1.0;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment,

  // Add optional integrations for additional features
  integrations: [
    Sentry.replayIntegration({
      // Capture more context in replays for debugging
      maskAllText: false,
      blockAllMedia: false,
    }),
    Sentry.feedbackIntegration({
      // Display a feedback button in the bottom-right corner
      autoInject: true,
      // Button styling
      colorScheme: 'system',
      // Form configuration
      showBranding: false,
      showName: true,
      showEmail: true,
      isNameRequired: false,
      isEmailRequired: false,
      // Messages
      buttonLabel: 'Report a Bug',
      submitButtonLabel: 'Send Feedback',
      formTitle: 'Report a Bug',
      messagePlaceholder: 'Describe what happened and what you expected...',
      successMessageText: 'Thank you for your feedback!',
    }),
  ],

  // Performance monitoring - lower in production to reduce overhead
  tracesSampleRate,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Session replay rates
  // - Development/Staging: 50% of sessions recorded for debugging
  // - Production: 10% of sessions recorded to reduce storage costs
  replaysSessionSampleRate,

  // Always capture replay when an error occurs (100%)
  replaysOnErrorSampleRate: 1.0,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  // Distributed tracing - propagate traces to API Gateway/Lambda
  // This enables connecting frontend errors to backend traces
  tracePropagationTargets: [
    'localhost',
    /^https:\/\/.*\.execute-api\..*\.amazonaws\.com/,
    /^https:\/\/api\..*/,
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'development';
const isProduction = environment === 'production';

// Adjust sample rates based on environment
const tracesSampleRate = isProduction ? 0.2 : 1.0;
const profilesSampleRate = isProduction ? 0.1 : 0.5;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment,

  // Integrations
  integrations: [
    Sentry.nodeProfilingIntegration(),
  ],

  // Performance monitoring - lower in production to reduce overhead
  tracesSampleRate,

  // Profiling - identify slow server-side code paths
  profilesSampleRate,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});

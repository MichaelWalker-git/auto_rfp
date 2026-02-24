// This file configures the initialization of Sentry on the client side.
// The config you add here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'development';
const isProduction = environment === 'production';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment,

  // Performance monitoring — lower in production to reduce overhead
  tracesSampleRate: isProduction ? 0.2 : 1.0,

  // Replay — capture 10% of sessions in production, 100% in dev
  replaysSessionSampleRate: isProduction ? 0.1 : 1.0,

  // Capture 100% of sessions with errors
  replaysOnErrorSampleRate: 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  sendDefaultPii: true,

  integrations: [
    // Session replay — records user interactions for debugging
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),

    // User Feedback widget — lets users report bugs and leave comments
    // Appears as a floating button in the bottom-right corner
    Sentry.feedbackIntegration({
      colorScheme: 'system',
      // Widget button label
      buttonLabel: 'Report a Bug',
      // Dialog title
      formTitle: 'Report a Bug or Leave Feedback',
      // Submit button label
      submitButtonLabel: 'Send Report',
      // Cancel button label
      cancelButtonLabel: 'Cancel',
      // Placeholder text for the description field
      messagePlaceholder: 'Describe what happened and what you expected to happen...',
      // Show name and email fields
      showName: true,
      showEmail: true,
      // Auto-fill name/email from Sentry user context if available
      useSentryUser: {
        name: 'username',
        email: 'email',
      },
      // Trigger screenshot capture
      enableScreenshot: true,
      // Position the widget
      triggerLabel: 'Report a Bug',
      triggerAriaLabel: 'Report a Bug',
    }),
  ],
});

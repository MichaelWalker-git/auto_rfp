// This file configures the initialization of Sentry on the client side.
// The config you add here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

// Import from @sentry/browser (not @sentry/nextjs) because this file is loaded
// via a 'use client' component for Turbopack compatibility, and @sentry/nextjs
// resolves to its server entry which lacks browser-only integrations.
import * as Sentry from '@sentry/browser';

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
      // Transparent button background, visible text and border
      themeLight: {
        submitBackground: '#6366f1',
        submitBackgroundHover: '#4f46e5',
        triggerBackground: 'transparent',
        triggerBorder: 'rgba(0, 0, 0, 0.15)',
        triggerColor: 'rgba(0, 0, 0, 0.6)',
      },
      themeDark: {
        submitBackground: '#6366f1',
        submitBackgroundHover: '#4f46e5',
        triggerBackground: 'transparent',
        triggerBorder: 'rgba(255, 255, 255, 0.15)',
        triggerColor: 'rgba(255, 255, 255, 0.6)',
      },
    }),
  ],
});

// Inject transparent background into Sentry feedback widget's shadow DOM
// The widget renders inside shadow DOM, so external CSS can't reach it
if (typeof window !== 'undefined') {
  const injectStyle = () => {
    const el = document.getElementById('sentry-feedback');
    if (!el?.shadowRoot) return false;
    const style = document.createElement('style');
    style.textContent = `.widget__actor { background: transparent !important; box-shadow: none !important; }`;
    el.shadowRoot.appendChild(style);
    return true;
  };

  // Try immediately, then retry with observer if widget hasn't mounted yet
  if (!injectStyle()) {
    const observer = new MutationObserver(() => {
      if (injectStyle()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Safety: stop observing after 10s
    setTimeout(() => observer.disconnect(), 10000);
  }
}

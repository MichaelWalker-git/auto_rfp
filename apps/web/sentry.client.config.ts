// This file configures the initialization of Sentry on the client side.
// The config you add here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

// Import from @sentry/browser (not @sentry/nextjs) because this file is loaded
// via a 'use client' component for Turbopack compatibility, and @sentry/nextjs
// resolves to its server entry which lacks browser-only integrations.
import * as Sentry from '@sentry/browser';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'development';
  const isProduction = environment === 'production';

  Sentry.init({
    dsn,
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
        buttonLabel: 'Report a Bug',
        formTitle: 'Report a Bug or Leave Feedback',
        submitButtonLabel: 'Send Report',
        cancelButtonLabel: 'Cancel',
        messagePlaceholder: 'Describe what happened and what you expected to happen...',
        showName: true,
        showEmail: true,
        useSentryUser: {
          name: 'username',
          email: 'email',
        },
        enableScreenshot: true,
        triggerLabel: 'Report a Bug',
        triggerAriaLabel: 'Report a Bug',
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
  if (typeof window !== 'undefined') {
    const injectStyle = () => {
      const el = document.getElementById('sentry-feedback');
      if (!el?.shadowRoot) return false;
      const style = document.createElement('style');
      style.textContent = `.widget__actor { background: transparent !important; box-shadow: none !important; }`;
      el.shadowRoot.appendChild(style);
      return true;
    };

    if (!injectStyle()) {
      const observer = new MutationObserver(() => {
        if (injectStyle()) observer.disconnect();
      });
      const target = document.body || document.documentElement;
      observer.observe(target, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 10000);
    }
  }
}

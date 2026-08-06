import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function complianceReviewDomain(): DomainRoutes {
  return {
    basePath: 'compliance-review',
    routes: [
      // Trigger an async full-package review (SQS worker).
      {
        method: 'POST',
        path: 'run',
        entry: lambdaEntry('compliance-review/trigger-review.ts'),
      },
      // Poll the latest run + decisions + staleness.
      {
        method: 'GET',
        path: 'run',
        entry: lambdaEntry('compliance-review/get-review.ts'),
      },
      // Synchronous conversational review (fast model, bounded tool rounds).
      {
        method: 'POST',
        path: 'chat',
        entry: lambdaEntry('compliance-review/chat.ts'),
        timeoutSeconds: 60,
        memorySize: 512,
      },
      {
        method: 'GET',
        path: 'history',
        entry: lambdaEntry('compliance-review/get-history.ts'),
      },
      // Dismiss / resolve a finding (by fingerprint).
      {
        method: 'POST',
        path: 'decision',
        entry: lambdaEntry('compliance-review/update-decision.ts'),
      },
    ],
  };
}

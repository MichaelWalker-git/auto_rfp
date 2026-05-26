import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function opportunityAssistantDomain(): DomainRoutes {
  return {
    basePath: 'opportunity-assistant',
    routes: [
      {
        method: 'POST',
        path: 'chat',
        entry: lambdaEntry('opportunity-assistant/chat.ts'),
        timeoutSeconds: 60,
        memorySize: 512,
      },
      {
        method: 'GET',
        path: 'history',
        entry: lambdaEntry('opportunity-assistant/get-history.ts'),
      },
    ],
  };
}

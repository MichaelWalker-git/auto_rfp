import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function engagementLogDomain(): DomainRoutes {
  return {
    basePath: 'engagement-log',
    routes: [
      {
        method: 'GET',
        path: 'list',
        entry: lambdaEntry('engagement-log/get-engagement-logs.ts'),
      },
      {
        method: 'POST',
        path: 'create',
        entry: lambdaEntry('engagement-log/create-engagement-log.ts'),
      },
      {
        method: 'GET',
        path: 'metrics',
        entry: lambdaEntry('engagement-log/get-engagement-metrics.ts'),
      },
    ],
  };
}

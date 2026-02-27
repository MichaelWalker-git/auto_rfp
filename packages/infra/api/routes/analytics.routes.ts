import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const analyticsDomain = (): DomainRoutes => ({
  basePath: 'analytics',
  routes: [
    {
      method: 'GET',
      path: 'get-analytics',
      entry: lambdaEntry('analytics/get-analytics.ts'),
    },
  ],
});

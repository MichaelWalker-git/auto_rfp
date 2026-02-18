import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';
export function deadlinesDomain(): DomainRoutes {
  return { basePath: 'deadlines', routes: [
    { method: 'GET', path: 'get-deadlines', entry: lambdaEntry('deadlines/get-deadlines.ts') },
    { method: 'GET', path: 'export-calendar', entry: lambdaEntry('deadlines/export-deadlines.ts') },
    { method: 'GET', path: 'subscription/{orgId}', entry: lambdaEntry('deadlines/get-calendar-subscription.ts') },
    { method: 'POST', path: 'subscription/{orgId}/regenerate', entry: lambdaEntry('deadlines/regenerate-calendar-subscription.ts') },
    { method: 'GET', path: 'subscribe/{orgId}/calendar.ics', entry: lambdaEntry('deadlines/serve-public-calendar.ts'), auth: 'NONE' },
  ]};
}

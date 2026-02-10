import type { DomainRoutes } from './types';
export function deadlinesDomain(): DomainRoutes {
  return { basePath: 'deadlines', routes: [
    { method: 'GET', path: 'get-deadlines', entry: 'lambda/deadlines/get-deadlines.ts' },
    { method: 'GET', path: 'export-calendar', entry: 'lambda/deadlines/export-deadlines.ts' },
    { method: 'GET', path: 'subscription/{orgId}', entry: 'lambda/deadlines/get-calendar-subscription.ts' },
    { method: 'POST', path: 'subscription/{orgId}/regenerate', entry: 'lambda/deadlines/regenerate-calendar-subscription.ts' },
    { method: 'GET', path: 'subscribe/{orgId}/calendar.ics', entry: 'lambda/deadlines/serve-public-calendar.ts', auth: 'NONE' },
  ]};
}

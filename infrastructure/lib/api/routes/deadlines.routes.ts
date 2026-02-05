import type { DomainRoutes } from './types';
export function deadlinesDomain(): DomainRoutes {
  return { basePath: 'deadlines', routes: [
    { method: 'GET', path: 'get-deadlines', entry: 'lambda/deadlines/get-deadlines.ts' },
    { method: 'GET', path: 'export-calendar', entry: 'lambda/deadlines/export-deadlines.ts' },
  ]};
}

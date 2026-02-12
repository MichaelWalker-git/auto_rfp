import type { DomainRoutes } from './types';
export function projectoutcomeDomain(): DomainRoutes {
  return { basePath: 'project-outcome', routes: [
    { method: 'POST', path: 'set-outcome', entry: 'lambda/project-outcome/set-outcome.ts' },
    { method: 'GET', path: 'get-outcome', entry: 'lambda/project-outcome/get-outcome.ts' },
    { method: 'GET', path: 'get-outcomes', entry: 'lambda/project-outcome/get-outcomes.ts' },
  ]};
}

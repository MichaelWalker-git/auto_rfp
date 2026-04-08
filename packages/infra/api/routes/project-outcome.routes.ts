import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';
export function projectoutcomeDomain(): DomainRoutes {
  return { basePath: 'project-outcome', routes: [
    { method: 'POST', path: 'set-outcome', entry: lambdaEntry('project-outcome/set-outcome.ts'), nodeModules: ['@aws-sdk/client-partnercentral-selling'], timeoutSeconds: 90 },
    { method: 'GET', path: 'get-outcome', entry: lambdaEntry('project-outcome/get-outcome.ts') },
    { method: 'GET', path: 'get-outcomes', entry: lambdaEntry('project-outcome/get-outcomes.ts') },
    { method: 'DELETE', path: 'remove-outcome', entry: lambdaEntry('project-outcome/remove-outcome.ts') },
  ]};
}

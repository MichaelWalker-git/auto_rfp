import type { DomainRoutes } from './types';
export function opportunityDomain(): DomainRoutes {
  return { basePath: 'opportunity', routes: [
    { method: 'GET', path: 'get-opportunities', entry: 'lambda/opportunity/get-opportunities.ts' },
    { method: 'POST', path: 'create-opportunity', entry: 'lambda/opportunity/create-opportunity.ts' },
    { method: 'GET', path: 'get-opportunity', entry: 'lambda/opportunity/get-opportunity.ts' },
  ]};
}

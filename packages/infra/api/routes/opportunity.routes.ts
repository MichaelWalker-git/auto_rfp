import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';
export function opportunityDomain(): DomainRoutes {
  return { basePath: 'opportunity', routes: [
    { method: 'GET', path: 'get-opportunities', entry: lambdaEntry('opportunity/get-opportunities.ts') },
    { method: 'POST', path: 'create-opportunity', entry: lambdaEntry('opportunity/create-opportunity.ts'), nodeModules: ['@aws-sdk/client-partnercentral-selling'], timeoutSeconds: 90 },
    { method: 'GET', path: 'get-opportunity', entry: lambdaEntry('opportunity/get-opportunity.ts') },
    { method: 'PUT', path: 'update-opportunity', entry: lambdaEntry('opportunity/update-opportunity.ts'), nodeModules: ['@aws-sdk/client-partnercentral-selling'], timeoutSeconds: 90 },
    { method: 'DELETE', path: 'delete-opportunity', entry: lambdaEntry('opportunity/delete-opportunity.ts') },
    // Pipeline stage transition (manual)
    { method: 'PATCH', path: 'stage', entry: lambdaEntry('opportunity/update-opportunity-stage.ts'), nodeModules: ['@aws-sdk/client-partnercentral-selling'], timeoutSeconds: 90 },
    // Assignment
    { method: 'POST', path: 'assign', entry: lambdaEntry('opportunity/assign-opportunity.ts') },
    // EventBridge event emission
    { method: 'POST', path: 'emit-event', entry: lambdaEntry('opportunity/emit-opportunity-event.ts'), nodeModules: ['@aws-sdk/client-eventbridge'] },
  ]};
}

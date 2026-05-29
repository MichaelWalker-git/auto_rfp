import type { DomainRoutes } from './types';
import { lambdaEntry } from './route-helper';

export function organizationDomain(): DomainRoutes {
  return { basePath: 'organization', routes: [
    { method: 'GET', path: 'get-organizations', entry: lambdaEntry('organization/get-organizations.ts') },
    { method: 'POST', path: 'create-organization', entry: lambdaEntry('organization/create-organization.ts') },
    { method: 'PATCH', path: 'edit-organization/{id}', entry: lambdaEntry('organization/edit-organization.ts') },
    { method: 'GET', path: 'get-organization/{id}', entry: lambdaEntry('organization/get-organization-by-id.ts') },
    { method: 'DELETE', path: 'delete-organization/{id}', entry: lambdaEntry('organization/delete-organization.ts') },
    { method: 'POST', path: 'upload-icon', entry: lambdaEntry('organization/upload-icon.ts') },
    { method: 'GET', path: 'get-icon', entry: lambdaEntry('organization/get-icon.ts') },
  ]};
}

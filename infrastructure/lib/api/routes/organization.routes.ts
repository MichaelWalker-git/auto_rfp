import type { DomainRoutes } from './types';
export function organizationDomain(): DomainRoutes {
  return { basePath: 'organization', routes: [
    { method: 'GET', path: 'get-organizations', entry: 'lambda/organization/get-organizations.ts' },
    { method: 'POST', path: 'create-organization', entry: 'lambda/organization/create-organization.ts' },
    { method: 'PATCH', path: 'edit-organization/{id}', entry: 'lambda/organization/edit-organization.ts' },
    { method: 'GET', path: 'get-organization/{id}', entry: 'lambda/organization/get-organization-by-id.ts' },
    { method: 'DELETE', path: 'delete-organization/{id}', entry: 'lambda/organization/delete-organization.ts' },
    { method: 'POST', path: 'upload-icon', entry: 'lambda/organization/upload-icon.ts' },
    { method: 'GET', path: 'get-icon', entry: 'lambda/organization/get-icon.ts' },
  ]};
}

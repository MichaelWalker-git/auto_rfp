import type { DomainRoutes } from './types';
import { lambdaEntry } from './route-helper';

export function organizationDomain(): DomainRoutes {
  return { basePath: 'organization', routes: [
    { method: 'GET', path: 'get-organizations', entry: lambdaEntry('organization/get-organizations.ts') },
    { method: 'POST', path: 'create-organization', entry: lambdaEntry('organization/create-organization.ts') },
    { method: 'PATCH', path: 'edit-organization/{id}', entry: lambdaEntry('organization/edit-organization.ts') },
    { method: 'GET', path: 'get-organization/{id}', entry: lambdaEntry('organization/get-organization-by-id.ts') },
    { method: 'DELETE', path: 'delete-organization/{id}', entry: lambdaEntry('organization/delete-organization.ts') },
    // 'upload-icon' route removed 2026-08-20 to free API Gateway integration slots
    // (0 invocations in Dev+Test over 13 months); handler organization/upload-icon.ts retained.
    { method: 'GET', path: 'get-icon', entry: lambdaEntry('organization/get-icon.ts') },
    // Primary contact (proposal signatory)
    { method: 'GET', path: '{orgId}/contact', entry: lambdaEntry('org-contact/get-org-contact.ts') },
    { method: 'PUT', path: '{orgId}/contact', entry: lambdaEntry('org-contact/upsert-org-contact.ts') },
    { method: 'DELETE', path: '{orgId}/contact', entry: lambdaEntry('org-contact/delete-org-contact.ts') },
  ]};
}

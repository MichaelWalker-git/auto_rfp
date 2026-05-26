import type { DomainRoutes } from './types';
import { lambdaEntry } from './route-helper';

export function companyProfileDomain(): DomainRoutes {
  return { basePath: 'company-profile', routes: [
    { method: 'GET', path: 'get', entry: lambdaEntry('company-profile/get-company-profile.ts') },
    { method: 'PUT', path: 'upsert', entry: lambdaEntry('company-profile/upsert-company-profile.ts') },
    { method: 'DELETE', path: 'delete', entry: lambdaEntry('company-profile/delete-company-profile.ts') },
  ]};
}

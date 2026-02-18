import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';
export function userDomain(): DomainRoutes {
  return { basePath: 'user', routes: [
    { method: 'POST', path: 'create-user', entry: lambdaEntry('user/create-user.ts') },
    { method: 'GET', path: 'get-user', entry: lambdaEntry('user/get-user.ts') },
    { method: 'GET', path: 'get-users', entry: lambdaEntry('user/get-users.ts') },
    { method: 'PATCH', path: 'edit-user', entry: lambdaEntry('user/edit-user.ts') },
    { method: 'DELETE', path: 'delete-user', entry: lambdaEntry('user/delete-user.ts') },
    { method: 'GET', path: 'get-my-organizations', entry: lambdaEntry('user/get-my-organizations.ts') },
    { method: 'POST', path: 'add-to-organization', entry: lambdaEntry('user/add-to-organization.ts') },
    { method: 'POST', path: 'remove-from-organization', entry: lambdaEntry('user/remove-from-organization.ts') },
    { method: 'PUT', path: 'set-last-org', entry: lambdaEntry('user/set-last-org.ts') },
  ]};
}

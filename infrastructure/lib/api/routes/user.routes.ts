import type { DomainRoutes } from './types';
export function userDomain(): DomainRoutes {
  return { basePath: 'user', routes: [
    { method: 'POST', path: 'create-user', entry: 'lambda/user/create-user.ts' },
    { method: 'GET', path: 'get-user', entry: 'lambda/user/get-user.ts' },
    { method: 'GET', path: 'get-users', entry: 'lambda/user/get-users.ts' },
    { method: 'PATCH', path: 'edit-user', entry: 'lambda/user/edit-user.ts' },
    { method: 'DELETE', path: 'delete-user', entry: 'lambda/user/delete-user.ts' },
    { method: 'GET', path: 'get-my-organizations', entry: 'lambda/user/get-my-organizations.ts' },
    { method: 'POST', path: 'add-to-organization', entry: 'lambda/user/add-to-organization.ts' },
    { method: 'POST', path: 'remove-from-organization', entry: 'lambda/user/remove-from-organization.ts' },
    { method: 'PUT', path: 'set-last-org', entry: 'lambda/user/set-last-org.ts' },
  ]};
}

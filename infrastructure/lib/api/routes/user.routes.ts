import type { DomainRoutes } from './types';
export function userDomain(): DomainRoutes {
  return { basePath: 'user', routes: [
    { method: 'POST', path: 'create-user', entry: 'lambda/user/create-user.ts' },
    { method: 'GET', path: 'get-user', entry: 'lambda/user/get-user.ts' },
    { method: 'GET', path: 'get-users', entry: 'lambda/user/get-users.ts' },
    { method: 'PATCH', path: 'edit-user', entry: 'lambda/user/edit-user.ts' },
    { method: 'DELETE', path: 'delete-user', entry: 'lambda/user/delete-user.ts' },
  ]};
}

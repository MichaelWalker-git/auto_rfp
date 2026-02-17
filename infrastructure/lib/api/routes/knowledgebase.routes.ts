import type { DomainRoutes } from './types';
export function knowledgebaseDomain(): DomainRoutes {
  return { basePath: 'knowledgebase', routes: [
    { method: 'POST', path: 'create-knowledgebase', entry: 'lambda/knowledgebase/create-knowledgebase.ts' },
    { method: 'DELETE', path: 'delete-knowledgebase', entry: 'lambda/knowledgebase/delete-knowledgebase.ts' },
    { method: 'PATCH', path: 'edit-knowledgebase', entry: 'lambda/knowledgebase/edit-knowledgebase.ts' },
    { method: 'GET', path: 'get-knowledgebases', entry: 'lambda/knowledgebase/get-knowledgebases.ts' },
    { method: 'GET', path: 'get-knowledgebase', entry: 'lambda/knowledgebase/get-knowledgebase.ts' },
    // KB access control
    { method: 'POST', path: 'grant-access', entry: 'lambda/knowledgebase/grant-kb-access.ts' },
    { method: 'POST', path: 'revoke-access', entry: 'lambda/knowledgebase/revoke-kb-access.ts' },
    { method: 'GET', path: 'get-access-users', entry: 'lambda/knowledgebase/get-access-users.ts' },
    { method: 'GET', path: 'get-user-kb-access', entry: 'lambda/knowledgebase/get-user-kb-access.ts' },
  ]};
}

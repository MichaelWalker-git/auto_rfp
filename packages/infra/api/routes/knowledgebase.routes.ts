import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';
export function knowledgebaseDomain(): DomainRoutes {
  return { basePath: 'knowledgebase', routes: [
    { method: 'POST', path: 'create-knowledgebase', entry: lambdaEntry('knowledgebase/create-knowledgebase.ts') },
    { method: 'DELETE', path: 'delete-knowledgebase', entry: lambdaEntry('knowledgebase/delete-knowledgebase.ts') },
    { method: 'PATCH', path: 'edit-knowledgebase', entry: lambdaEntry('knowledgebase/edit-knowledgebase.ts') },
    { method: 'GET', path: 'get-knowledgebases', entry: lambdaEntry('knowledgebase/get-knowledgebases.ts') },
    { method: 'GET', path: 'get-knowledgebase', entry: lambdaEntry('knowledgebase/get-knowledgebase.ts') },
    // KB access control
    { method: 'POST', path: 'grant-access', entry: lambdaEntry('knowledgebase/grant-kb-access.ts') },
    { method: 'POST', path: 'revoke-access', entry: lambdaEntry('knowledgebase/revoke-kb-access.ts') },
    { method: 'GET', path: 'get-access-users', entry: lambdaEntry('knowledgebase/get-access-users.ts') },
    { method: 'GET', path: 'get-user-kb-access', entry: lambdaEntry('knowledgebase/get-user-kb-access.ts') },
  ]};
}

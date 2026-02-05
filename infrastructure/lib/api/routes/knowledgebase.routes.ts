import type { DomainRoutes } from './types';
export function knowledgebaseDomain(): DomainRoutes {
  return { basePath: 'knowledgebase', routes: [
    { method: 'POST', path: 'create-knowledgebase', entry: 'lambda/knowledgebase/create-knowledgebase.ts' },
    { method: 'DELETE', path: 'delete-knowledgebase', entry: 'lambda/knowledgebase/delete-knowledgebase.ts' },
    { method: 'PATCH', path: 'edit-knowledgebase', entry: 'lambda/knowledgebase/edit-knowledgebase.ts' },
    { method: 'GET', path: 'get-knowledgebases', entry: 'lambda/knowledgebase/get-knowledgebases.ts' },
    { method: 'GET', path: 'get-knowledgebase', entry: 'lambda/knowledgebase/get-knowledgebase.ts' },
  ]};
}

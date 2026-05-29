import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';
export function documentDomain(): DomainRoutes {
  return { basePath: 'document', routes: [
    { method: 'POST', path: 'create-document', entry: lambdaEntry('document/create-document.ts') },
    { method: 'PATCH', path: 'edit-document', entry: lambdaEntry('document/edit-document.ts') },
    { method: 'DELETE', path: 'delete-document', entry: lambdaEntry('document/delete-document.ts') },
    { method: 'GET', path: 'get-documents', entry: lambdaEntry('document/get-documents.ts') },
    { method: 'GET', path: 'get-document', entry: lambdaEntry('document/get-document.ts') },
    { method: 'POST', path: 'start-document-pipeline', entry: lambdaEntry('document/start-document-pipeline.ts') },
    { method: 'GET', path: 'download', entry: lambdaEntry('document/download-document.ts') },
  ]};
}

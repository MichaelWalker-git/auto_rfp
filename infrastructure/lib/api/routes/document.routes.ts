import type { DomainRoutes } from './types';
export function documentDomain(): DomainRoutes {
  return { basePath: 'document', routes: [
    { method: 'POST', path: 'create-document', entry: 'lambda/document/create-document.ts' },
    { method: 'PATCH', path: 'edit-document', entry: 'lambda/document/edit-document.ts' },
    { method: 'DELETE', path: 'delete-document', entry: 'lambda/document/delete-document.ts' },
    { method: 'GET', path: 'get-documents', entry: 'lambda/document/get-documents.ts' },
    { method: 'GET', path: 'get-document', entry: 'lambda/document/get-document.ts' },
    { method: 'POST', path: 'start-document-pipeline', entry: 'lambda/document/start-document-pipeline.ts' },
    { method: 'GET', path: 'download', entry: 'lambda/document/download-document.ts' },
  ]};
}

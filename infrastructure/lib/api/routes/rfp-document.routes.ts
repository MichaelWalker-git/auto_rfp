import type { DomainRoutes } from './types';

export function rfpDocumentDomain(): DomainRoutes {
  return {
    basePath: 'rfp-document',
    routes: [
      { method: 'POST', path: 'create', entry: 'lambda/rfp-document/create-rfp-document.ts' },
      { method: 'GET', path: 'list', entry: 'lambda/rfp-document/get-rfp-documents.ts' },
      { method: 'GET', path: 'get', entry: 'lambda/rfp-document/get-rfp-document.ts' },
      { method: 'PATCH', path: 'update', entry: 'lambda/rfp-document/update-rfp-document.ts' },
      { method: 'DELETE', path: 'delete', entry: 'lambda/rfp-document/delete-rfp-document.ts' },
      { method: 'POST', path: 'preview-url', entry: 'lambda/rfp-document/get-document-preview-url.ts' },
      { method: 'POST', path: 'download-url', entry: 'lambda/rfp-document/get-document-download-url.ts' },
      { method: 'POST', path: 'update-signature', entry: 'lambda/rfp-document/update-signature-status.ts' },
    ],
  };
}
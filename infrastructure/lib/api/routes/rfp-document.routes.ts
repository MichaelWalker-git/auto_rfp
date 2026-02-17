import type { DomainRoutes } from './types';

export function rfpDocumentDomain(args?: {
  documentGenerationQueueUrl?: string;
}): DomainRoutes {
  const docGenQueueUrl = args?.documentGenerationQueueUrl || '';

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
      { method: 'POST', path: 'export', entry: 'lambda/rfp-document/export-rfp-document.ts' },
      { method: 'POST', path: 'generate-proposal', entry: 'lambda/rfp-document/generate-proposal.ts' },
      {
        method: 'POST',
        path: 'generate-document',
        entry: 'lambda/rfp-document/generate-document.ts',
        extraEnv: { DOCUMENT_GENERATION_QUEUE_URL: docGenQueueUrl },
      },
      { method: 'POST', path: 'convert-to-content', entry: 'lambda/rfp-document/convert-to-content.ts' },
      { method: 'POST', path: 'sync-to-google-drive', entry: 'lambda/rfp-document/sync-to-google-drive.ts', timeoutSeconds: 60 },
    ],
  };
}

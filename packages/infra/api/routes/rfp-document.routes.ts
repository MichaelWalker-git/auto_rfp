import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function rfpDocumentDomain(args?: {
  documentGenerationQueueUrl?: string;
}): DomainRoutes {
  const docGenQueueUrl = args?.documentGenerationQueueUrl || '';

  return {
    basePath: 'rfp-document',
    routes: [
      { method: 'POST', path: 'create', entry: lambdaEntry('rfp-document/create-rfp-document.ts') },
      { method: 'GET', path: 'list', entry: lambdaEntry('rfp-document/get-rfp-documents.ts') },
      { method: 'GET', path: 'get', entry: lambdaEntry('rfp-document/get-rfp-document.ts') },
      { method: 'PATCH', path: 'update', entry: lambdaEntry('rfp-document/update-rfp-document.ts') },
      { method: 'DELETE', path: 'delete', entry: lambdaEntry('rfp-document/delete-rfp-document.ts') },
      { method: 'POST', path: 'preview-url', entry: lambdaEntry('rfp-document/get-document-preview-url.ts') },
      { method: 'POST', path: 'download-url', entry: lambdaEntry('rfp-document/get-document-download-url.ts') },
      { method: 'POST', path: 'update-signature', entry: lambdaEntry('rfp-document/update-signature-status.ts') },
      { method: 'POST', path: 'export', entry: lambdaEntry('rfp-document/export-rfp-document.ts') },
      { method: 'POST', path: 'generate-proposal', entry: lambdaEntry('rfp-document/generate-proposal.ts') },
      {
        method: 'POST',
        path: 'generate-document',
        entry: lambdaEntry('rfp-document/generate-document.ts'),
        extraEnv: { DOCUMENT_GENERATION_QUEUE_URL: docGenQueueUrl },
      },
      { method: 'POST', path: 'convert-to-content', entry: lambdaEntry('rfp-document/convert-to-content.ts') },
      { method: 'POST', path: 'sync-to-google-drive', entry: lambdaEntry('rfp-document/sync-to-google-drive.ts'), timeoutSeconds: 60 },
    ],
  };
}

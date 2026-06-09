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
      {
        method: 'POST',
        path: 'export',
        entry: lambdaEntry('rfp-document/export-rfp-document.ts'),
        memorySize: 1536,
        timeoutSeconds: 60,
        nodeModules: ['@sparticuz/chromium', 'puppeteer-core', 'html-to-docx'],
      },
      {
        method: 'POST',
        path: 'export-all',
        entry: lambdaEntry('rfp-document/export-all-rfp-documents.ts'),
        memorySize: 2048,
        timeoutSeconds: 120,
        // pdfjs-dist + @napi-rs/canvas are deliberately NOT bundled here.
        // They live in the dedicated rasterize-pdf-worker Lambda which this
        // function invokes synchronously when an encrypted PDF is hit.
        // Keeping them out of every export bundle keeps us under the 250 MB
        // unzipped Lambda hard limit.
        nodeModules: ['@sparticuz/chromium', 'puppeteer-core', 'html-to-docx', 'jszip'],
      },
      {
        method: 'POST',
        path: 'generate-document',
        entry: lambdaEntry('rfp-document/generate-document.ts'),
        extraEnv: { DOCUMENT_GENERATION_QUEUE_URL: docGenQueueUrl },
      },
      {
        method: 'POST',
        path: 'generate-questionnaire',
        entry: lambdaEntry('rfp-document/generate-questionnaire-document.ts'),
        memorySize: 512,
        timeoutSeconds: 60,
        nodeModules: ['exceljs'],
      },
      { method: 'POST', path: 'convert-to-content', entry: lambdaEntry('rfp-document/convert-to-content.ts') },
      { method: 'POST', path: 'sync-to-google-drive', entry: lambdaEntry('rfp-document/sync-to-google-drive.ts'), timeoutSeconds: 60 },
      { method: 'POST', path: 'sync-from-google-drive', entry: lambdaEntry('rfp-document/sync-from-google-drive.ts'), timeoutSeconds: 60 },
      { method: 'GET', path: 'html-content', entry: lambdaEntry('rfp-document/get-html-content.ts') },
      { method: 'GET', path: 'custom-document-types', entry: lambdaEntry('rfp-document/get-custom-document-types.ts') },
      { method: 'POST', path: 'custom-document-types', entry: lambdaEntry('rfp-document/save-custom-document-type.ts') },
      // Version comparison routes
      { method: 'GET', path: 'versions', entry: lambdaEntry('rfp-document/get-versions.ts') },
      { method: 'GET', path: 'compare', entry: lambdaEntry('rfp-document/compare-versions.ts') },
      { method: 'POST', path: 'revert', entry: lambdaEntry('rfp-document/revert-version.ts') },
      { method: 'POST', path: 'cherry-pick', entry: lambdaEntry('rfp-document/cherry-pick-version.ts') },
      // AI-powered section editing (chat interface)
      // Increased timeout for large documents (questionnaires can be 60k+ chars)
      { method: 'POST', path: 'edit-section', entry: lambdaEntry('rfp-document/edit-section.ts'), timeoutSeconds: 180, memorySize: 512 },
      { method: 'GET', path: 'chat-messages', entry: lambdaEntry('rfp-document/get-chat-messages.ts') },
    ],
  };
}

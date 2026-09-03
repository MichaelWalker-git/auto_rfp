import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

/**
 * @param renameChunksQueueUrl - URL of the SQS queue that the edit-document
 * handler enqueues to for renames on documents with more than 1 000 chunks
 * (ticket 04), so the update loop runs off the request path.
 */
export function documentDomain(args?: { renameChunksQueueUrl?: string }): DomainRoutes {
  const renameChunksQueueUrl = args?.renameChunksQueueUrl || '';
  return { basePath: 'document', routes: [
    { method: 'POST', path: 'create-document', entry: lambdaEntry('document/create-document.ts') },
    {
      method: 'PATCH',
      path: 'edit-document',
      entry: lambdaEntry('document/edit-document.ts'),
      extraEnv: { RENAME_CHUNKS_QUEUE_URL: renameChunksQueueUrl },
    },
    { method: 'DELETE', path: 'delete-document', entry: lambdaEntry('document/delete-document.ts') },
    { method: 'GET', path: 'get-documents', entry: lambdaEntry('document/get-documents.ts') },
    { method: 'GET', path: 'get-document', entry: lambdaEntry('document/get-document.ts') },
    { method: 'POST', path: 'start-document-pipeline', entry: lambdaEntry('document/start-document-pipeline.ts') },
    { method: 'GET', path: 'download', entry: lambdaEntry('document/download-document.ts') },
  ]};
}

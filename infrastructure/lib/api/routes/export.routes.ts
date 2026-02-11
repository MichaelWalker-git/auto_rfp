import type { DomainRoutes } from './types';

export function exportDomain(): DomainRoutes {
  return {
    basePath: 'export',
    routes: [
      { method: 'POST', path: 'generate-word', entry: 'lambda/export/generate-word.ts' },
      { method: 'POST', path: 'generate-pdf', entry: 'lambda/export/generate-pdf.ts' },
      { method: 'POST', path: 'generate-html', entry: 'lambda/export/generate-html.ts' },
      { method: 'POST', path: 'generate-txt', entry: 'lambda/export/generate-txt.ts' },
      { method: 'POST', path: 'generate-pptx', entry: 'lambda/export/generate-pptx.ts', memorySize: 512 },
      { method: 'POST', path: 'generate-md', entry: 'lambda/export/generate-md.ts' },
      { method: 'POST', path: 'generate-batch', entry: 'lambda/export/generate-batch.ts', memorySize: 512, timeoutSeconds: 60 },
    ],
  };
}
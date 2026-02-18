import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function exportDomain(): DomainRoutes {
  return {
    basePath: 'export',
    routes: [
      { method: 'POST', path: 'generate-word', entry: lambdaEntry('export/generate-word.ts') },
      { method: 'POST', path: 'generate-pdf', entry: lambdaEntry('export/generate-pdf.ts') },
      { method: 'POST', path: 'generate-html', entry: lambdaEntry('export/generate-html.ts') },
      { method: 'POST', path: 'generate-txt', entry: lambdaEntry('export/generate-txt.ts') },
      { method: 'POST', path: 'generate-pptx', entry: lambdaEntry('export/generate-pptx.ts'), memorySize: 512 },
      { method: 'POST', path: 'generate-md', entry: lambdaEntry('export/generate-md.ts') },
      { method: 'POST', path: 'generate-batch', entry: lambdaEntry('export/generate-batch.ts'), memorySize: 512, timeoutSeconds: 60 },
    ],
  };
}
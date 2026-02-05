import type { DomainRoutes } from './types';
export function exportDomain(): DomainRoutes {
  return { basePath: 'export', routes: [
    { method: 'POST', path: 'generate-word', entry: 'lambda/export/generate-word.ts' },
  ]};
}

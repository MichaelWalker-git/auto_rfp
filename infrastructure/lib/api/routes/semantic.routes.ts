import type { DomainRoutes } from './types';
export function semanticDomain(): DomainRoutes {
  return { basePath: 'semantic', routes: [
    { method: 'POST', path: 'search', entry: 'lambda/semanticsearch/search.ts' },
  ]};
}

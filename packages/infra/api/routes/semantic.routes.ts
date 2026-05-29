import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';
export function semanticDomain(): DomainRoutes {
  return { basePath: 'semantic', routes: [
    { method: 'POST', path: 'search', entry: lambdaEntry('semanticsearch/search.ts') },
  ]};
}

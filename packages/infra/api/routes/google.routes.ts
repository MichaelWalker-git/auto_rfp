import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function googleDomain(): DomainRoutes {
  return {
    basePath: 'google',
    routes: [
      { method: 'GET', path: 'get-api-key', entry: lambdaEntry('google/get-api-key.ts') },
      { method: 'POST', path: 'set-api-key', entry: lambdaEntry('google/set-api-key.ts') },
    ],
  };
}
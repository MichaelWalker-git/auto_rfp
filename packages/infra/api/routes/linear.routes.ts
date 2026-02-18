import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export const linearRoutes: DomainRoutes = {
  basePath: 'linear',
  routes: [
    {
      path: 'get-api-key',
      method: 'GET',
      entry: lambdaEntry('linear/get-api-key.ts'),
    },
    {
      path: 'save-api-key',
      method: 'POST',
      entry: lambdaEntry('linear/save-api-key.ts'),
    },
  ],
};

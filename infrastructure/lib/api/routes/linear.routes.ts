import type { DomainRoutes } from './types';

export const linearRoutes: DomainRoutes = {
  basePath: 'linear',
  routes: [
    {
      path: 'get-api-key',
      method: 'GET',
      entry: 'lambda/linear/get-api-key.ts',
    },
    {
      path: 'save-api-key',
      method: 'POST',
      entry: 'lambda/linear/save-api-key.ts',
    },
  ],
};

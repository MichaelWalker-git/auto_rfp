import type { DomainRoutes } from './types';
import * as path from 'path';

const lambdaPath = path.join(__dirname, '../../../lambda/linear');

export const linearRoutes: DomainRoutes = {
  basePath: 'linear',
  routes: [
    {
      path: 'get-api-key',
      method: 'GET',
      entry: path.join(lambdaPath, 'get-api-key.ts'),
    },
    {
      path: 'save-api-key',
      method: 'POST',
      entry: path.join(lambdaPath, 'save-api-key.ts'),
    },
  ],
};

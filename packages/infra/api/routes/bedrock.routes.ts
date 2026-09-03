import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export const bedrockRoutes: DomainRoutes = {
  basePath: 'bedrock',
  routes: [
    {
      path: 'get-config',
      method: 'GET',
      entry: lambdaEntry('bedrock/get-config.ts'),
    },
    {
      path: 'set-config',
      method: 'POST',
      entry: lambdaEntry('bedrock/set-config.ts'),
    },
  ],
};

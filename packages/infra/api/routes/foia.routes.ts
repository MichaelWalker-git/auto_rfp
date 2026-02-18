import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function foiaDomain(): DomainRoutes {
  return {
    basePath: 'foia',
    routes: [
      {
        method: 'POST',
        path: 'create-foia-request',
        entry: lambdaEntry('foia/create-foia-request.ts'),
      },
      {
        method: 'GET',
        path: 'get-foia-requests',
        entry: lambdaEntry('foia/get-foia-requests.ts'),
      },
      {
        method: 'PATCH',
        path: 'update-foia-request',
        entry: lambdaEntry('foia/update-foia-request.ts'),
      },
      {
        method: 'POST',
        path: 'generate-foia-letter',
        entry: lambdaEntry('foia/generate-foia-letter.ts'),
      },
    ],
  };
}
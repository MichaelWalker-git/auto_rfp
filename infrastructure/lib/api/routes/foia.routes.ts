import type { DomainRoutes } from './types';

export function foiaDomain(): DomainRoutes {
  return {
    basePath: 'foia',
    routes: [
      {
        method: 'POST',
        path: 'create-foia-request',
        entry: 'lambda/foia/create-foia-request.ts',
      },
      {
        method: 'GET',
        path: 'get-foia-requests',
        entry: 'lambda/foia/get-foia-requests.ts',
      },
      {
        method: 'PATCH',
        path: 'update-foia-request',
        entry: 'lambda/foia/update-foia-request.ts',
      },
      {
        method: 'POST',
        path: 'generate-foia-letter',
        entry: 'lambda/foia/generate-foia-letter.ts',
      },
    ],
  };
}
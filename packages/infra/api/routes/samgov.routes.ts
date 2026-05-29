import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function samgovDomain(): DomainRoutes {
  return {
    basePath: 'samgov',
    routes: [
      // API Key Management Endpoints
      { method: 'POST', path: 'set-api-key', entry: lambdaEntry('samgov/set-api-key.ts') },
      { method: 'GET', path: 'get-api-key', entry: lambdaEntry('samgov/get-api-key.ts') },

      // SAM.gov Operations
      {
        method: 'POST',
        path: 'import-solicitation',
        entry: lambdaEntry('samgov/import-solicitation.ts'),
      },
      {
        method: 'POST',
        path: 'create-saved-search',
        entry: lambdaEntry('samgov/create-saved-search.ts'),
      },

      { method: 'GET', path: 'list-saved-search', entry: lambdaEntry('samgov/list-saved-search.ts') },
      { method: 'DELETE', path: 'delete-saved-search/{id}', entry: lambdaEntry('samgov/delete-saved-search.ts') },
      { method: 'PATCH', path: 'edit-saved-search/{id}', entry: lambdaEntry('samgov/edit-saved-search.ts') },

      {
        method: 'POST',
        path: 'search-opportunities',
        entry: lambdaEntry('samgov/search-opportunities.ts'),
      },
      {
        method: 'POST',
        path: 'opportunity-description',
        entry: lambdaEntry('samgov/get-opportunity-description.ts'),
      },
    ],
  };
}
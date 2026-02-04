import type { DomainRoutes } from './types';

export function samgovDomain(): DomainRoutes {
  return {
    basePath: 'samgov',
    routes: [
      // API Key Management Endpoints
      { method: 'POST', path: 'set-api-key', entry: 'lambda/samgov/set-api-key.ts' },
      { method: 'GET', path: 'get-api-key', entry: 'lambda/samgov/get-api-key.ts' },
      { method: 'OPTIONS', path: 'get-api-key', entry: 'lambda/samgov/get-api-key.ts' },
      { method: 'DELETE', path: 'delete-api-key', entry: 'lambda/samgov/delete-api-key.ts' },
      { method: 'GET', path: 'validate-api-key', entry: 'lambda/samgov/validate-api-key.ts' },

      // SAM.gov Operations
      {
        method: 'POST',
        path: 'import-solicitation',
        entry: 'lambda/samgov/import-solicitation.ts',
      },
      {
        method: 'POST',
        path: 'create-saved-search',
        entry: 'lambda/samgov/create-saved-search.ts',
      },

      { method: 'GET', path: 'list-saved-search', entry: 'lambda/samgov/list-saved-search.ts' },
      { method: 'DELETE', path: 'delete-saved-search/{id}', entry: 'lambda/samgov/delete-saved-search.ts' },
      { method: 'PATCH', path: 'edit-saved-search/{id}', entry: 'lambda/samgov/edit-saved-search.ts' },

      {
        method: 'POST',
        path: 'opportunities',
        entry: 'lambda/samgov/search-opportunities.ts',
      },
      {
        method: 'POST',
        path: 'opportunity-description',
        entry: 'lambda/samgov/get-opportunity-description.ts',
      },
    ],
  };
}
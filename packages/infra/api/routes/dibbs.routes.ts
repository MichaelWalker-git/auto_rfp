import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const dibbsDomain = (): DomainRoutes => ({
  basePath: 'dibbs',
  routes: [
    // API Key Management
    { method: 'POST',   path: 'set-api-key',              entry: lambdaEntry('dibbs/set-api-key.ts') },
    { method: 'GET',    path: 'get-api-key',              entry: lambdaEntry('dibbs/get-api-key.ts') },
    // Search & Import
    { method: 'POST',   path: 'search-opportunities',     entry: lambdaEntry('dibbs/search-opportunities.ts') },
    { method: 'POST',   path: 'import-solicitation',      entry: lambdaEntry('dibbs/import-solicitation.ts'), timeoutSeconds: 60 },
    // Saved Searches
    { method: 'POST',   path: 'create-saved-search',      entry: lambdaEntry('dibbs/create-saved-search.ts') },
    { method: 'GET',    path: 'list-saved-search',        entry: lambdaEntry('dibbs/list-saved-search.ts') },
    { method: 'PATCH',  path: 'edit-saved-search/{id}',   entry: lambdaEntry('dibbs/edit-saved-search.ts') },
    { method: 'DELETE', path: 'delete-saved-search/{id}', entry: lambdaEntry('dibbs/delete-saved-search.ts') },
  ],
});

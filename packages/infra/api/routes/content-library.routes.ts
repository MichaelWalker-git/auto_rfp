import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';
export function contentlibraryDomain(): DomainRoutes {
  return { basePath: 'content-library', routes: [
    { method: 'GET', path: 'get-content-libraries', entry: lambdaEntry('content-library/get-content-libraries.ts') },
    { method: 'POST', path: 'create-content-library', entry: lambdaEntry('content-library/create-content-library.ts') },
    { method: 'GET', path: 'get-content-library/{id}', entry: lambdaEntry('content-library/get-item.ts') },
    { method: 'PATCH', path: 'edit-content-library/{id}', entry: lambdaEntry('content-library/edit.ts') },
    { method: 'DELETE', path: 'delete-content-library/{id}', entry: lambdaEntry('content-library/delete-content-library.ts') },
    { method: 'POST', path: 'approve/{id}', entry: lambdaEntry('content-library/approve-content.ts') },
    { method: 'POST', path: 'deprecate/{id}', entry: lambdaEntry('content-library/deprecate.ts') },
    { method: 'POST', path: 'track-usage/{id}', entry: lambdaEntry('content-library/track-usage.ts') },
    { method: 'GET', path: 'categories', entry: lambdaEntry('content-library/categories.ts') },
    { method: 'GET', path: 'tags', entry: lambdaEntry('content-library/tags.ts') },
    // Stale content detection endpoints
    { method: 'GET', path: 'stale-report', entry: lambdaEntry('content-library/get-stale-report.ts') },
    { method: 'POST', path: 'reactivate/{id}', entry: lambdaEntry('content-library/reactivate-item.ts') },
    { method: 'POST', path: 'bulk-review', entry: lambdaEntry('content-library/bulk-review.ts') },
  ]};
}

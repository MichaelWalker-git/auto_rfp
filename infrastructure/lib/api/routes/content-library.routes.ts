import type { DomainRoutes } from './types';
export function contentlibraryDomain(): DomainRoutes {
  return { basePath: 'content-library', routes: [
    { method: 'GET', path: 'get-content-libraries', entry: 'lambda/content-library/get-content-libraries.ts' },
    { method: 'POST', path: 'create-content-library', entry: 'lambda/content-library/create-content-library.ts' },
    { method: 'GET', path: 'get-content-library/{id}', entry: 'lambda/content-library/get-item.ts' },
    { method: 'PATCH', path: 'edit-content-library/{id}', entry: 'lambda/content-library/edit.ts' },
    { method: 'DELETE', path: 'delete-content-library/{id}', entry: 'lambda/content-library/delete-content-library.ts' },
    { method: 'POST', path: 'approve/{id}', entry: 'lambda/content-library/approve-content.ts' },
    { method: 'POST', path: 'deprecate/{id}', entry: 'lambda/content-library/deprecate.ts' },
    { method: 'POST', path: 'track-usage/{id}', entry: 'lambda/content-library/track-usage.ts' },
    { method: 'GET', path: 'categories', entry: 'lambda/content-library/categories.ts' },
    { method: 'GET', path: 'tags', entry: 'lambda/content-library/tags.ts' },
  ]};
}

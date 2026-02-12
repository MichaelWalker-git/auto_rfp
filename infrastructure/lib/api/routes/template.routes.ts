import type { DomainRoutes } from './types';

export function templateDomain(): DomainRoutes {
  return {
    basePath: 'templates',
    routes: [
      // P0 — Core CRUD
      { method: 'GET', path: 'list', entry: 'lambda/templates/get-templates.ts' },
      { method: 'GET', path: 'get/{id}', entry: 'lambda/templates/get-template.ts' },
      { method: 'POST', path: 'create', entry: 'lambda/templates/create-template.ts' },
      { method: 'PATCH', path: 'update/{id}', entry: 'lambda/templates/update-template.ts' },
      { method: 'DELETE', path: 'delete/{id}', entry: 'lambda/templates/delete-template.ts' },
      { method: 'POST', path: 'apply/{id}', entry: 'lambda/templates/apply-template.ts' },
      { method: 'GET', path: 'categories', entry: 'lambda/templates/get-template-categories.ts' },

      // P1 — Version Control & Workflow
      { method: 'POST', path: 'clone/{id}', entry: 'lambda/templates/clone-template.ts' },
      { method: 'GET', path: 'versions/{id}', entry: 'lambda/templates/get-template-versions.ts' },
      { method: 'POST', path: 'restore/{id}/{version}', entry: 'lambda/templates/restore-template-version.ts' },
      { method: 'POST', path: 'publish/{id}', entry: 'lambda/templates/publish-template.ts' },

      // P2 — Import/Export & Preview
      { method: 'POST', path: 'import', entry: 'lambda/templates/import-template.ts' },
      { method: 'GET', path: 'export/{id}', entry: 'lambda/templates/export-template.ts' },
      { method: 'GET', path: 'preview/{id}', entry: 'lambda/templates/preview-template.ts' },
    ],
  };
}
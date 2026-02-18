import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function templateDomain(): DomainRoutes {
  return {
    basePath: 'templates',
    routes: [
      // P0 — Core CRUD
      { method: 'GET', path: 'list', entry: lambdaEntry('templates/get-templates.ts') },
      { method: 'GET', path: 'get/{id}', entry: lambdaEntry('templates/get-template.ts') },
      { method: 'POST', path: 'create', entry: lambdaEntry('templates/create-template.ts') },
      { method: 'PATCH', path: 'update/{id}', entry: lambdaEntry('templates/update-template.ts') },
      { method: 'DELETE', path: 'delete/{id}', entry: lambdaEntry('templates/delete-template.ts') },
      { method: 'POST', path: 'apply/{id}', entry: lambdaEntry('templates/apply-template.ts') },
      { method: 'GET', path: 'categories', entry: lambdaEntry('templates/get-template-categories.ts') },

      // P1 — Version Control & Workflow
      { method: 'POST', path: 'clone/{id}', entry: lambdaEntry('templates/clone-template.ts') },
      { method: 'GET', path: 'versions/{id}', entry: lambdaEntry('templates/get-template-versions.ts') },
      { method: 'POST', path: 'restore/{id}/{version}', entry: lambdaEntry('templates/restore-template-version.ts') },
      { method: 'POST', path: 'publish/{id}', entry: lambdaEntry('templates/publish-template.ts') },

      // P2 — Import/Export & Preview
      { method: 'POST', path: 'import', entry: lambdaEntry('templates/import-template.ts') },
      { method: 'GET', path: 'export/{id}', entry: lambdaEntry('templates/export-template.ts') },
      { method: 'GET', path: 'preview/{id}', entry: lambdaEntry('templates/preview-template.ts') },
    ],
  };
}
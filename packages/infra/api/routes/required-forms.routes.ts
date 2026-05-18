import type { DomainRoutes } from './types';
import { lambdaEntry } from './route-helper';

export function requiredFormsDomain(): DomainRoutes {
  return { basePath: 'required-forms', routes: [
    { method: 'GET', path: 'list', entry: lambdaEntry('required-forms/list-required-forms.ts') },
    { method: 'GET', path: 'get', entry: lambdaEntry('required-forms/get-required-form.ts') },
    { method: 'PUT', path: 'field', entry: lambdaEntry('required-forms/update-form-field.ts') },
    { method: 'DELETE', path: 'delete', entry: lambdaEntry('required-forms/delete-required-form.ts') },
    { method: 'GET', path: 'export', entry: lambdaEntry('required-forms/export-filled-form.ts'), timeoutSeconds: 60 },
    { method: 'POST', path: 'reprocess', entry: lambdaEntry('required-forms/reprocess-form.ts'), timeoutSeconds: 120 },
  ]};
}

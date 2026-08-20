import type { DomainRoutes } from './types';
import { lambdaEntry } from './route-helper';

export function requiredFormsDomain(): DomainRoutes {
  return { basePath: 'required-forms', routes: [
    { method: 'GET', path: 'list', entry: lambdaEntry('required-forms/list-required-forms.ts') },
    { method: 'GET', path: 'get', entry: lambdaEntry('required-forms/get-required-form.ts') },
    // Form version history (parity with RFP document versions).
    { method: 'GET', path: 'versions', entry: lambdaEntry('required-forms/list-form-versions.ts') },
    { method: 'POST', path: 'revert-version', entry: lambdaEntry('required-forms/revert-form-version.ts') },
    { method: 'GET', path: 'render', entry: lambdaEntry('required-forms/render-docx-form.ts'), timeoutSeconds: 30 },
    { method: 'PUT', path: 'field', entry: lambdaEntry('required-forms/update-form-field.ts') },
    { method: 'PUT', path: 'save-fields', entry: lambdaEntry('required-forms/save-form-fields.ts') },
    { method: 'DELETE', path: 'delete', entry: lambdaEntry('required-forms/delete-required-form.ts') },
    {
      method: 'GET',
      path: 'export',
      entry: lambdaEntry('required-forms/export-filled-form.ts'),
      timeoutSeconds: 120,
      // pdfjs-dist + @napi-rs/canvas live in the dedicated rasterize-pdf-worker
      // Lambda — we invoke it synchronously when we hit an encrypted PDF.
    },
    { method: 'POST', path: 'reprocess', entry: lambdaEntry('required-forms/reprocess-form.ts'), timeoutSeconds: 120 },
    { method: 'POST', path: 'ai-fill-field', entry: lambdaEntry('required-forms/ai-fill-field.ts'), timeoutSeconds: 60 },
    { method: 'POST', path: 'attach', entry: lambdaEntry('required-forms/attach-form-to-proposal.ts') },
    { method: 'DELETE', path: 'attach', entry: lambdaEntry('required-forms/attach-form-to-proposal.ts') },
    {
      method: 'POST',
      path: 'export-all',
      entry: lambdaEntry('required-forms/export-all-required-forms.ts'),
      timeoutSeconds: 300,
      memorySize: 2048,
    },
  ]};
}

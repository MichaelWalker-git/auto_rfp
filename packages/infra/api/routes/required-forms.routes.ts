import type { DomainRoutes } from './types';
import { lambdaEntry } from './route-helper';

export function requiredFormsDomain(): DomainRoutes {
  return { basePath: 'required-forms', routes: [
    { method: 'GET', path: 'list', entry: lambdaEntry('required-forms/list-required-forms.ts') },
    { method: 'GET', path: 'get', entry: lambdaEntry('required-forms/get-required-form.ts') },
    { method: 'PUT', path: 'field', entry: lambdaEntry('required-forms/update-form-field.ts') },
    { method: 'PUT', path: 'save-fields', entry: lambdaEntry('required-forms/save-form-fields.ts') },
    { method: 'DELETE', path: 'delete', entry: lambdaEntry('required-forms/delete-required-form.ts') },
    {
      method: 'GET',
      path: 'export',
      entry: lambdaEntry('required-forms/export-filled-form.ts'),
      timeoutSeconds: 120,
      // pdfjs-dist + @napi-rs/canvas (with native binary) are installed into the
      // Lambda zip at synth time so esbuild doesn't try to bundle them.
      nodeModules: ['pdfjs-dist', '@napi-rs/canvas'],
      // @napi-rs/canvas ships platform-specific binaries — install inside the
      // Lambda runtime image so we ship Linux x64 regardless of the dev host.
      forceDockerBundling: true,
    },
    { method: 'POST', path: 'reprocess', entry: lambdaEntry('required-forms/reprocess-form.ts'), timeoutSeconds: 120 },
    { method: 'POST', path: 'ai-fill-field', entry: lambdaEntry('required-forms/ai-fill-field.ts'), timeoutSeconds: 60 },
  ]};
}

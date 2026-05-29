import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export function opportunityContextDomain(): DomainRoutes {
  return {
    basePath: 'opportunity-context',
    routes: [
      {
        method: 'GET',
        path: 'search',
        entry: lambdaEntry('opportunity-context/get-opportunity-context.ts'),
        // Longer timeout: runs 3 parallel embedding searches + S3 loads
        timeoutSeconds: 30,
      },
      {
        method: 'PUT',
        path: 'override',
        entry: lambdaEntry('opportunity-context/upsert-context-override.ts'),
      },
      {
        method: 'DELETE',
        path: 'override',
        entry: lambdaEntry('opportunity-context/remove-context-override.ts'),
      },
    ],
  };
}

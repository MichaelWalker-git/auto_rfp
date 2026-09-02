import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

/**
 * Related-RFP REST routes (HOR-2610). The auto-discovery worker
 * (find-related-rfps) is NOT routed here — it is invoked asynchronously and
 * defined directly in the API orchestrator stack.
 */
export function relatedRfpDomain(): DomainRoutes {
  return {
    basePath: 'related-rfps',
    routes: [
      { method: 'GET', path: 'list', entry: lambdaEntry('related-rfp/list-related-rfps.ts') },
      { method: 'POST', path: 'create', entry: lambdaEntry('related-rfp/create-related-rfp.ts') },
      { method: 'DELETE', path: '{relatedOppKey}', entry: lambdaEntry('related-rfp/delete-related-rfp.ts') },
      {
        method: 'POST',
        path: 'refresh',
        entry: lambdaEntry('related-rfp/refresh-related-rfps.ts'),
        nodeModules: ['@aws-sdk/client-lambda'],
      },
      { method: 'GET', path: 'agency-history', entry: lambdaEntry('related-rfp/agency-history.ts') },
    ],
  };
}

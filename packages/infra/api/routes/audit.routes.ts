import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const auditDomain = (): DomainRoutes => ({
  basePath: 'audit',
  routes: [
    {
      method: 'GET',
      path: 'logs',
      entry: lambdaEntry('audit/query-logs.ts'),
    },
    {
      method: 'POST',
      path: 'report',
      entry: lambdaEntry('audit/generate-report.ts'),
      timeoutSeconds: 60, // report generation may paginate many log pages
      memorySize: 512,
    },
  ],
});

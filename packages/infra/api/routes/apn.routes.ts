import type { DomainRoutes } from './types';
import { lambdaEntry } from './route-helper';

/** APN domain — no REST API routes (sync happens automatically via Lambda helpers) */
export const apnDomain = (): DomainRoutes => ({
  basePath: 'apn',
  routes: [
    { method: 'POST', path: 'sync', entry: lambdaEntry('apn/sync.ts') },
  ],
});

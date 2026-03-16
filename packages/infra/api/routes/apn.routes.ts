import type { DomainRoutes } from './types';

/** APN domain — no REST API routes (sync happens automatically via Lambda helpers) */
export const apnDomain = (): DomainRoutes => ({
  basePath: 'apn',
  routes: [],
});

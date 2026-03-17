import type { DomainRoutes } from './types';

export const pricingDomain = (): DomainRoutes => ({
  basePath: 'pricing',
  routes: [
    {
      method: 'POST',
      path: '/labor-rates',
      entry: 'handlers/pricing/create-labor-rate.ts',
      auth: 'COGNITO',
    },
    {
      method: 'GET', 
      path: '/labor-rates',
      entry: 'handlers/pricing/get-labor-rates.ts',
      auth: 'COGNITO',
    },
    {
      method: 'POST',
      path: '/calculate-estimate',
      entry: 'handlers/pricing/calculate-estimate.ts',
      auth: 'COGNITO',
    },
  ],
});

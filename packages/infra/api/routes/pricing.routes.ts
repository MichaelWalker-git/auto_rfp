import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const pricingDomain = (): DomainRoutes => ({
  basePath: 'pricing',
  routes: [
    // Labor Rates
    {
      method: 'POST',
      path: 'labor-rates',
      entry: lambdaEntry('pricing/create-labor-rate.ts'),
      auth: 'COGNITO',
    },
    {
      method: 'GET',
      path: 'labor-rates',
      entry: lambdaEntry('pricing/get-labor-rates.ts'),
      auth: 'COGNITO',
    },
    {
      method: 'PUT',
      path: 'labor-rates',
      entry: lambdaEntry('pricing/update-labor-rate.ts'),
      auth: 'COGNITO',
    },
    {
      method: 'DELETE',
      path: 'labor-rates',
      entry: lambdaEntry('pricing/delete-labor-rate.ts'),
      auth: 'COGNITO',
    },
    // BOM Items
    {
      method: 'POST',
      path: 'bom-items',
      entry: lambdaEntry('pricing/create-bom-item.ts'),
      auth: 'COGNITO',
    },
    {
      method: 'GET',
      path: 'bom-items',
      entry: lambdaEntry('pricing/get-bom-items.ts'),
      auth: 'COGNITO',
    },
    {
      method: 'DELETE',
      path: 'bom-items',
      entry: lambdaEntry('pricing/delete-bom-item.ts'),
      auth: 'COGNITO',
    },
    // Staffing Plans
    {
      method: 'POST',
      path: 'staffing-plans',
      entry: lambdaEntry('pricing/create-staffing-plan.ts'),
      auth: 'COGNITO',
    },
    {
      method: 'GET',
      path: 'staffing-plans',
      entry: lambdaEntry('pricing/get-staffing-plans.ts'),
      auth: 'COGNITO',
    },
    {
      method: 'DELETE',
      path: 'staffing-plans',
      entry: lambdaEntry('pricing/delete-staffing-plan.ts'),
      auth: 'COGNITO',
    },
    // Cost Estimates
    {
      method: 'POST',
      path: 'calculate-estimate',
      entry: lambdaEntry('pricing/calculate-estimate.ts'),
      auth: 'COGNITO',
    },
    {
      method: 'GET',
      path: 'estimates',
      entry: lambdaEntry('pricing/get-estimates.ts'),
      auth: 'COGNITO',
    },
    // Bid/No-Bid Analysis
    {
      method: 'POST',
      path: 'analyze-bid',
      entry: lambdaEntry('pricing/analyze-bid.ts'),
      auth: 'COGNITO',
    },
    // Export
    {
      method: 'POST',
      path: 'export',
      entry: lambdaEntry('pricing/export-pricing.ts'),
      auth: 'COGNITO',
    },
  ],
});

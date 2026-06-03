import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const universalApprovalDomain = (): DomainRoutes => ({
  basePath: 'universal-approval',
  routes: [
    { method: 'POST', path: 'request',       entry: lambdaEntry('universal-approval/request-approval.ts') },
    { method: 'POST', path: 'submit-review', entry: lambdaEntry('universal-approval/submit-review.ts') },
    { method: 'GET',  path: 'history',       entry: lambdaEntry('universal-approval/get-approval-history.ts') },
  ],
});

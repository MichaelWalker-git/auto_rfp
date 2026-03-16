import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const documentApprovalDomain = (): DomainRoutes => ({
  basePath: 'document-approval',
  routes: [
    { method: 'POST', path: 'request',          entry: lambdaEntry('document-approval/request-approval.ts') },
    { method: 'POST', path: 'review',           entry: lambdaEntry('document-approval/submit-review.ts') },
    { method: 'GET',  path: 'history',          entry: lambdaEntry('document-approval/get-approval-history.ts') },
    { method: 'GET',  path: 'enhanced-history', entry: lambdaEntry('document-approval/get-enhanced-approval-history.ts') },
    { method: 'GET',  path: 'assigned-reviews', entry: lambdaEntry('document-approval/get-assigned-reviews.ts') },
    { method: 'POST', path: 'resubmit',         entry: lambdaEntry('document-approval/resubmit-for-review.ts') },
    { method: 'POST', path: 'bulk-review',      entry: lambdaEntry('document-approval/bulk-review.ts') },
  ],
});

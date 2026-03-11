import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const proposalSubmissionDomain = (): DomainRoutes => ({
  basePath: 'proposal-submission',
  routes: [
    { method: 'GET',  path: 'readiness',  entry: lambdaEntry('proposal-submission/get-submission-readiness.ts') },
    { method: 'GET',  path: 'compliance', entry: lambdaEntry('proposal-submission/check-compliance.ts') },
    { method: 'POST', path: 'submit',     entry: lambdaEntry('proposal-submission/submit-proposal.ts') },
    { method: 'GET',  path: 'history',    entry: lambdaEntry('proposal-submission/get-submission-history.ts') },
    { method: 'POST', path: 'withdraw',   entry: lambdaEntry('proposal-submission/withdraw-submission.ts') },
  ],
});

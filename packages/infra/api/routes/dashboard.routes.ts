import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

/**
 * RFP Tracking dashboard routes.
 * - get-rfp-pipeline: org-wide opportunity list for the board / queue / flags.
 * - decide-rfp-approval: two-gate approval write-back on the approvalStatus axis
 *   (gate 1: Initial Approval → I Approved / Not Approved; gate 2: Pre Sub → II Approved).
 * - advance-rfp-approval: non-gate stage moves (I Approved → Pre Sub, II Approved → Submitted).
 * - update-ace-stage: manual ACE (AWS Partner Central) lifecycle stage change + PC push.
 *
 * decide-rfp-approval and update-ace-stage bundle the Partner Central SDK and
 * get a 90s timeout because they push to Partner Central inline (best-effort).
 */
export function dashboardDomain(): DomainRoutes {
  return { basePath: 'dashboard', routes: [
    { method: 'GET', path: 'get-rfp-pipeline', entry: lambdaEntry('dashboard/get-rfp-pipeline.ts') },
    { method: 'POST', path: 'decide-rfp-approval', entry: lambdaEntry('dashboard/decide-rfp-approval.ts'), nodeModules: ['@aws-sdk/client-partnercentral-selling'], timeoutSeconds: 90 },
    { method: 'POST', path: 'advance-rfp-approval', entry: lambdaEntry('dashboard/advance-rfp-approval.ts') },
    { method: 'POST', path: 'update-ace-stage', entry: lambdaEntry('dashboard/update-ace-stage.ts'), nodeModules: ['@aws-sdk/client-partnercentral-selling'], timeoutSeconds: 90 },
  ]};
}

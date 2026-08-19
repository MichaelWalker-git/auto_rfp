import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function questionnaireDomain(): DomainRoutes {
  return {
    basePath: 'questionnaire',
    routes: [
      // Version history for file-based XLSX questionnaires (parity with RFP
      // document + required-form versions).
      { method: 'GET', path: 'versions', entry: lambdaEntry('questionnaire/list-questionnaire-versions.ts') },
      { method: 'POST', path: 'revert-version', entry: lambdaEntry('questionnaire/revert-questionnaire-version.ts') },
    ],
  };
}

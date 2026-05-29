import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function debriefingDomain(): DomainRoutes {
  return {
    basePath: 'debriefing',
    routes: [
      {
        method: 'POST',
        path: 'create-debriefing',
        entry: lambdaEntry('debriefing/create-debriefing.ts'),
      },
      {
        method: 'GET',
        path: 'get-debriefing',
        entry: lambdaEntry('debriefing/get-debriefing.ts'),
      },
      {
        method: 'PATCH',
        path: 'update-debriefing',
        entry: lambdaEntry('debriefing/update-debriefing.ts'),
      },
    ],
  };
}
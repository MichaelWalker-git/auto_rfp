import type { DomainRoutes } from './types';

export function debriefingDomain(): DomainRoutes {
  return {
    basePath: 'debriefing',
    routes: [
      {
        method: 'POST',
        path: 'create-debriefing',
        entry: 'lambda/debriefing/create-debriefing.ts',
      },
      {
        method: 'GET',
        path: 'get-debriefing',
        entry: 'lambda/debriefing/get-debriefing.ts',
      },
      {
        method: 'PATCH',
        path: 'update-debriefing',
        entry: 'lambda/debriefing/update-debriefing.ts',
      },
    ],
  };
}
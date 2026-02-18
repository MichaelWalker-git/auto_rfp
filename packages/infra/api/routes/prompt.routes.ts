import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function promptDomain(): DomainRoutes {
  return {
    basePath: 'prompt',
    routes: [
      { method: 'POST', path: 'save-prompt/{scope}', entry: lambdaEntry('prompt/save-prompt.ts') },
      { method: 'GET', path: 'get-prompts', entry: lambdaEntry('prompt/get-prompts.ts') },
    ],
  };
}

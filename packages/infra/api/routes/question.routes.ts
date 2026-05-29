import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';
export function questionDomain(): DomainRoutes {
  return { basePath: 'question', routes: [
    { method: 'POST', path: 'create-question', entry: lambdaEntry('question/create-question.ts') },
    { method: 'DELETE', path: 'delete-question', entry: lambdaEntry('question/delete-question.ts') },
  ]};
}

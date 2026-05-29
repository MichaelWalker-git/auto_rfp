import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';
export function answerDomain(): DomainRoutes {
  return { basePath: 'answer', routes: [
    { method: 'GET', path: 'get-answers/{id}', entry: lambdaEntry('answer/get-answers.ts') },
    { method: 'GET', path: 'low-confidence/{id}', entry: lambdaEntry('answer/get-low-confidence-answers.ts') },
    { method: 'POST', path: 'save-answer', entry: lambdaEntry('answer/save-answer.ts') },
    { method: 'POST', path: 'generate-answer', entry: lambdaEntry('answer/generate-answer.ts') },
  ]};
}

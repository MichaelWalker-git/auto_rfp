import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';
export function answerDomain(): DomainRoutes {
  return { basePath: 'answer', routes: [
    { method: 'GET', path: 'get-answers/{id}', entry: lambdaEntry('answer/get-answers.ts') },
    { method: 'GET', path: 'generation-status/{id}', entry: lambdaEntry('answer/get-answer-generation-status.ts') },
    // 'low-confidence/{id}' route removed 2026-08-20 to free API Gateway integration slots
    // (0 invocations in Dev+Test over 13 months); handler answer/get-low-confidence-answers.ts retained.
    { method: 'POST', path: 'save-answer', entry: lambdaEntry('answer/save-answer.ts') },
    { method: 'POST', path: 'generate-answer', entry: lambdaEntry('answer/generate-answer.ts') },
  ]};
}

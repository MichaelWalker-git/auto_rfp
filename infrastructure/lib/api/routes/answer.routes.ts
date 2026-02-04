import type { DomainRoutes } from './types';
export function answerDomain(): DomainRoutes {
  return { basePath: 'answer', routes: [
    { method: 'GET', path: 'get-answers/{id}', entry: 'lambda/answer/get-answers.ts' },
    { method: 'POST', path: 'save-answer', entry: 'lambda/answer/save-answer.ts' },
    { method: 'POST', path: 'generate-answer', entry: 'lambda/answer/generate-answer.ts' },
  ]};
}

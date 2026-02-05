import type { DomainRoutes } from './types';
export function questionDomain(): DomainRoutes {
  return { basePath: 'question', routes: [
    { method: 'DELETE', path: 'delete-question', entry: 'lambda/question/delete-question.ts' },
  ]};
}

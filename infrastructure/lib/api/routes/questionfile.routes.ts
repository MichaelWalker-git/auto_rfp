import type { DomainRoutes } from './types';
export function questionfileDomain(): DomainRoutes {
  return { basePath: 'questionfile', routes: [
    { method: 'POST', path: 'start-question-pipeline', entry: 'lambda/question-file/start-question-pipeline.ts' },
    { method: 'POST', path: 'create-question-file', entry: 'lambda/question-file/create-question-file.ts' },
    { method: 'GET', path: 'get-question-file', entry: 'lambda/question-file/get-question-file.ts' },
    { method: 'GET', path: 'get-question-files', entry: 'lambda/question-file/get-question-files.ts' },
    { method: 'DELETE', path: 'delete-question-file', entry: 'lambda/question-file/delete-question-file.ts' },
    { method: 'POST', path: 'stop-question-pipeline', entry: 'lambda/question-file/stop-question-pipeline.ts' },
  ]};
}

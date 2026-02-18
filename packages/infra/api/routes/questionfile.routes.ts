import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';
export function questionfileDomain(): DomainRoutes {
  return { basePath: 'questionfile', routes: [
    { method: 'POST', path: 'start-question-pipeline', entry: lambdaEntry('question-file/start-question-pipeline.ts') },
    { method: 'POST', path: 'create-question-file', entry: lambdaEntry('question-file/create-question-file.ts') },
    { method: 'GET', path: 'get-question-file', entry: lambdaEntry('question-file/get-question-file.ts') },
    { method: 'GET', path: 'get-question-files', entry: lambdaEntry('question-file/get-question-files.ts') },
    { method: 'DELETE', path: 'delete-question-file', entry: lambdaEntry('question-file/delete-question-file.ts') },
    { method: 'POST', path: 'stop-question-pipeline', entry: lambdaEntry('question-file/stop-question-pipeline.ts') },
  ]};
}

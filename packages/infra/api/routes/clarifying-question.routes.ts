import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function clarifyingQuestionDomain(): DomainRoutes {
  return {
    basePath: 'clarifying-question',
    routes: [
      {
        method: 'GET',
        path: 'list',
        entry: lambdaEntry('clarifying-question/get-clarifying-questions.ts'),
      },
      {
        method: 'POST',
        path: 'generate',
        entry: lambdaEntry('clarifying-question/generate-clarifying-questions.ts'),
        // API Gateway REST API has a hard limit of 29 seconds for integration timeout
        // Lambda timeout is set slightly higher to ensure Lambda doesn't timeout before API Gateway
        timeoutSeconds: 29,
        memorySize: 1024,
      },
      {
        method: 'PUT',
        path: '{questionId}',
        entry: lambdaEntry('clarifying-question/update-clarifying-question.ts'),
      },
    ],
  };
}

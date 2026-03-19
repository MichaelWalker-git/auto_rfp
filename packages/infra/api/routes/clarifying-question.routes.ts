import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

/**
 * Clarifying question routes.
 * The generate endpoint now triggers async processing via SQS.
 *
 * @param clarifyingQuestionQueueUrl - URL of the SQS queue for async question generation
 */
export function clarifyingQuestionDomain(clarifyingQuestionQueueUrl: string): DomainRoutes {
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
        // Now async — just enqueues work, returns immediately
        timeoutSeconds: 10,
        memorySize: 256,
        extraEnv: {
          CLARIFYING_QUESTION_QUEUE_URL: clarifyingQuestionQueueUrl,
        },
      },
      {
        method: 'PUT',
        path: '{questionId}',
        entry: lambdaEntry('clarifying-question/update-clarifying-question.ts'),
      },
    ],
  };
}

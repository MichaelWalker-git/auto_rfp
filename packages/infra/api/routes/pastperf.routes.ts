import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function pastperfDomain(args: {
  execBriefQueueUrl: string;
}): DomainRoutes {
  const { execBriefQueueUrl } = args;

  return {
    basePath: 'pastperf',
    routes: [
      // Past Project CRUD
      {
        method: 'POST',
        path: 'create-project',
        entry: lambdaEntry('pastperf/create-project.ts'),
      },
      {
        method: 'POST',
        path: 'update-project',
        entry: lambdaEntry('pastperf/update-project.ts'),
      },
      {
        method: 'POST',
        path: 'delete-project',
        entry: lambdaEntry('pastperf/delete-project.ts'),
      },
      {
        method: 'POST',
        path: 'get-project',
        entry: lambdaEntry('pastperf/get-project.ts'),
      },
      {
        method: 'POST',
        path: 'list-projects',
        entry: lambdaEntry('pastperf/list-projects.ts'),
      },

      // Stale content detection
      {
        method: 'PATCH',
        path: 'set-last-used/{projectId}',
        entry: lambdaEntry('pastperf/set-last-used.ts'),
      },

      // Matching & Analysis
      {
        method: 'POST',
        path: 'reindex-projects',
        entry: lambdaEntry('pastperf/reindex-projects.ts'),
        timeoutSeconds: 300,
        memorySize: 512,
      },
      {
        method: 'POST',
        path: 'match-projects',
        entry: lambdaEntry('pastperf/match-projects.ts'),
        extraEnv: { 
          EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl,
          BRIEF_MAX_SOLICITATION_CHARS: '45000',
        },
        timeoutSeconds: 120,
        memorySize: 1024,
      },
      {
        method: 'POST',
        path: 'generate-narrative',
        entry: lambdaEntry('pastperf/generate-narrative.ts'),
        extraEnv: { 
          EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl,
          BRIEF_MAX_SOLICITATION_CHARS: '45000',
        },
        timeoutSeconds: 180,
        memorySize: 1024,
      },
      {
        method: 'POST',
        path: 'gap-analysis',
        entry: lambdaEntry('pastperf/gap-analysis.ts'),
        extraEnv: {
          EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl,
          BRIEF_MAX_SOLICITATION_CHARS: '45000',
        },
        timeoutSeconds: 120,
        memorySize: 1024,
      },

      // Disclosure classification & review (NDA / permission gating)
      {
        method: 'POST',
        path: 'classify-disclosure',
        entry: lambdaEntry('pastperf/classify-disclosure.ts'),
        // Synchronous behind API Gateway HTTP API — its integration timeout is
        // capped at 30s. Batches run concurrently in the handler; keep the Lambda
        // timeout under the gateway ceiling so failures surface as errors, not hangs.
        timeoutSeconds: 29,
        memorySize: 1024,
        // Classification is cheap/high-volume → use the fast Sonnet model rather
        // than the stack-wide Opus default. Must be an ACTIVE id the Bedrock API
        // key can invoke (NOT a Legacy/EOL id like claude-3-haiku-20240307).
        extraEnv: { BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6' },
      },
      {
        method: 'POST',
        path: 'confirm-disclosure',
        entry: lambdaEntry('pastperf/confirm-disclosure.ts'),
      },
    ],
  };
}
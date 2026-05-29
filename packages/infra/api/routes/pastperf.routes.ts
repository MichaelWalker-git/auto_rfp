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

      // Matching & Analysis
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
    ],
  };
}
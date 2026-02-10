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
        entry: 'lambda/pastperf/create-project.ts',
      },
      {
        method: 'POST',
        path: 'update-project',
        entry: 'lambda/pastperf/update-project.ts',
      },
      {
        method: 'POST',
        path: 'delete-project',
        entry: 'lambda/pastperf/delete-project.ts',
      },
      {
        method: 'POST',
        path: 'get-project',
        entry: 'lambda/pastperf/get-project.ts',
      },
      {
        method: 'POST',
        path: 'list-projects',
        entry: 'lambda/pastperf/list-projects.ts',
      },

      // Matching & Analysis
      {
        method: 'POST',
        path: 'match-projects',
        entry: 'lambda/pastperf/match-projects.ts',
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
        entry: 'lambda/pastperf/generate-narrative.ts',
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
        entry: 'lambda/pastperf/gap-analysis.ts',
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
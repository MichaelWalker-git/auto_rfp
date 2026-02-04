import type { DomainRoutes } from './types';

export function briefDomain(args: {
  execBriefQueueUrl: string;
  linearApiKeySecretArn: string;
}): DomainRoutes {
  const { execBriefQueueUrl, linearApiKeySecretArn } = args;

  return {
    basePath: 'brief',
    routes: [
      {
        method: 'POST',
        path: 'init-executive-brief',
        entry: 'lambda/brief/init-executive-brief.ts',
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
      {
        method: 'POST',
        path: 'generate-executive-brief-summary',
        entry: 'lambda/brief/generate-summary.ts',
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
      {
        method: 'POST',
        path: 'generate-executive-brief-deadlines',
        entry: 'lambda/brief/generate-deadlines.ts',
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
      {
        method: 'POST',
        path: 'generate-executive-brief-contacts',
        entry: 'lambda/brief/generate-contacts.ts',
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
      {
        method: 'POST',
        path: 'generate-executive-brief-requirements',
        entry: 'lambda/brief/generate-requirements.ts',
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
      {
        method: 'POST',
        path: 'generate-executive-brief-risks',
        entry: 'lambda/brief/generate-risks.ts',
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
      {
        method: 'POST',
        path: 'generate-executive-brief-scoring',
        entry: 'lambda/brief/generate-scoring.ts',
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },

      { method: 'POST', path: 'get-executive-brief-by-project', entry: 'lambda/brief/get-executive-brief-by-project.ts' },

      {
        method: 'POST',
        path: 'handle-linear-ticket',
        entry: 'lambda/brief/handle-linear-ticket.ts',
        extraEnv: { LINEAR_API_KEY_SECRET_ARN: linearApiKeySecretArn },
      },

      { method: 'POST', path: 'update-decision', entry: 'lambda/brief/update-decision.ts' },
    ],
  };
}
import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function briefDomain(args: {
  execBriefQueueUrl: string;
  googleDriveSyncQueueUrl: string;
  frontendUrl?: string;
}): DomainRoutes {
  const { execBriefQueueUrl, googleDriveSyncQueueUrl, frontendUrl } = args;

  // Public frontend URL used to build the opportunity deep-link in Linear
  // tickets. Falls back to the prod custom domain so the handler never crashes
  // if the value is unset at synth time.
  const appUrl = frontendUrl ?? 'https://rfp.horustech.dev';

  return {
    basePath: 'brief',
    routes: [
      {
        method: 'POST',
        path: 'init-executive-brief',
        entry: lambdaEntry('brief/init-executive-brief.ts'),
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
        timeoutSeconds: 30,
      },
      {
        method: 'POST',
        path: 'generate-executive-brief-summary',
        entry: lambdaEntry('brief/generate-summary.ts'),
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
      {
        method: 'POST',
        path: 'generate-executive-brief-deadlines',
        entry: lambdaEntry('brief/generate-deadlines.ts'),
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
      {
        method: 'POST',
        path: 'generate-executive-brief-contacts',
        entry: lambdaEntry('brief/generate-contacts.ts'),
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
      {
        method: 'POST',
        path: 'generate-executive-brief-requirements',
        entry: lambdaEntry('brief/generate-requirements.ts'),
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
      {
        method: 'POST',
        path: 'generate-executive-brief-risks',
        entry: lambdaEntry('brief/generate-risks.ts'),
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
      {
        method: 'POST',
        path: 'generate-pricing',
        entry: lambdaEntry('brief/generate-pricing.ts'),
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
      {
        method: 'POST',
        path: 'generate-executive-brief-scoring',
        entry: lambdaEntry('brief/generate-scoring.ts'),
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },

      { method: 'POST', path: 'get-executive-brief-by-project', entry: lambdaEntry('brief/get-executive-brief-by-project.ts') },

      {
        method: 'POST',
        path: 'handle-linear-ticket',
        entry: lambdaEntry('brief/handle-linear-ticket.ts'),
        extraEnv: { APP_URL: appUrl },
      },

      {
        // Also hosts the "Create Drive folder" action via an optional
        // `action: 'create-drive-folder'` discriminator in the body — folded
        // in here to stay under the HTTP API's integration cap (HOR-2729).
        method: 'POST',
        path: 'update-decision',
        entry: lambdaEntry('brief/update-decision.ts'),
        extraEnv: { GOOGLE_DRIVE_SYNC_QUEUE_URL: googleDriveSyncQueueUrl },
      },
      {
        method: 'POST',
        path: 'export-brief-docx',
        entry: lambdaEntry('brief/export-brief-docx.ts'),
      },
    ],
  };
}

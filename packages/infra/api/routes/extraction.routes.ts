import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export interface ExtractionDomainConfig {
  extractionQueueUrl: string;
}

export function extractionDomain(config?: ExtractionDomainConfig): DomainRoutes {
  return {
    basePath: 'extraction',
    routes: [
      // Start a new extraction job
      {
        method: 'POST',
        path: 'start-job',
        entry: lambdaEntry('extraction/start-extraction-job.ts'),
        timeoutSeconds: 30,
        extraEnv: {
          EXTRACTION_QUEUE_URL: config?.extractionQueueUrl || '',
        },
      },
      // Get extraction job status
      {
        method: 'GET',
        path: 'job',
        entry: lambdaEntry('extraction/get-extraction-job.ts'),
      },
      // List draft past projects
      {
        method: 'GET',
        path: 'drafts',
        entry: lambdaEntry('extraction/list-drafts.ts'),
      },
      // Confirm or discard a draft (action: 'confirm' | 'discard' in body)
      {
        method: 'POST',
        path: 'drafts',
        entry: lambdaEntry('extraction/draft-action.ts'),
      },
    ],
  };
}

import type { DomainRoutes } from './types';
import { lambdaEntry } from './route-helper';

export function clusteringDomain(): DomainRoutes {
  return {
    basePath: 'clustering',
    routes: [
      { method: 'GET', path: 'clusters/{projectId}', entry: lambdaEntry('clustering/get-clusters.ts') },
      { method: 'GET', path: 'similar/{projectId}/{questionId}', entry: lambdaEntry('clustering/find-similar-questions.ts') },
      { method: 'POST', path: 'apply-answer', entry: lambdaEntry('clustering/apply-cluster-answer.ts') },
    ],
  };
}

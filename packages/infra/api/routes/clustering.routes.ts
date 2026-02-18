import type { DomainRoutes } from './types';

export function clusteringDomain(): DomainRoutes {
  return {
    basePath: 'clustering',
    routes: [
      { method: 'GET', path: 'clusters/{projectId}', entry: 'lambda/clustering/get-clusters.ts' },
      { method: 'GET', path: 'similar/{projectId}/{questionId}', entry: 'lambda/clustering/find-similar-questions.ts' },
      { method: 'POST', path: 'apply-answer', entry: 'lambda/clustering/apply-cluster-answer.ts' },
    ],
  };
}
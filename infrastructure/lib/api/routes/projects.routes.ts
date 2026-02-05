import type { DomainRoutes } from './types';

export function projectsDomain(): DomainRoutes {
  return {
    basePath: 'projects',
    routes: [
      { method: 'POST', path: 'create', entry: 'lambda/project/create-project.ts' },
      { method: 'GET', path: 'list', entry: 'lambda/project/get-projects.ts' },
      { method: 'GET', path: 'get/{projectId}', entry: 'lambda/project/get-project-by-id.ts' },
      { method: 'PUT', path: 'update/{projectId}', entry: 'lambda/project/edit-project.ts' },
      { method: 'DELETE', path: 'delete/{projectId}', entry: 'lambda/project/delete-project.ts' },
      { method: 'GET', path: 'questions/{projectId}', entry: 'lambda/project/get-questions.ts' },
      { method: 'POST', path: 'answer/{projectId}', entry: 'lambda/project/answer-questions.ts' },
    ],
  };
}

import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function projectsDomain(): DomainRoutes {
  return {
    basePath: 'projects',
    routes: [
      { method: 'POST', path: 'create', entry: lambdaEntry('project/create-project.ts') },
      { method: 'GET', path: 'list', entry: lambdaEntry('project/get-projects.ts') },
      { method: 'GET', path: 'get/{projectId}', entry: lambdaEntry('project/get-project-by-id.ts') },
      { method: 'PUT', path: 'update/{projectId}', entry: lambdaEntry('project/edit-project.ts') },
      { method: 'DELETE', path: 'delete/{projectId}', entry: lambdaEntry('project/delete-project.ts') },
      { method: 'GET', path: 'questions/{projectId}', entry: lambdaEntry('project/get-questions.ts') },
      { method: 'POST', path: 'answer/{projectId}', entry: lambdaEntry('project/answer-questions.ts') },

      // Project ↔ Knowledge Base linking
      { method: 'GET', path: 'get-project-kbs', entry: lambdaEntry('project/get-project-kbs.ts') },
      { method: 'POST', path: 'link-kb', entry: lambdaEntry('project/link-kb.ts') },
      { method: 'DELETE', path: 'unlink-kb', entry: lambdaEntry('project/unlink-kb.ts') },
    ],
  };
}

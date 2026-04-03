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
      { method: 'GET', path: 'questions-count/{projectId}', entry: lambdaEntry('project/get-questions-count.ts') },

      // Project ↔ Knowledge Base linking
      { method: 'GET', path: 'get-project-kbs', entry: lambdaEntry('project/get-project-kbs.ts') },
      { method: 'POST', path: 'link-kb', entry: lambdaEntry('project/link-kb.ts') },
      { method: 'DELETE', path: 'unlink-kb', entry: lambdaEntry('project/unlink-kb.ts') },

      // Project ↔ User access management
      { method: 'POST', path: 'access/assign', entry: lambdaEntry('project/assign-project-access.ts') },
      { method: 'POST', path: 'access/revoke', entry: lambdaEntry('project/revoke-project-access.ts') },
      { method: 'POST', path: 'access/grant-admins', entry: lambdaEntry('project/grant-admin-access.ts') },
      { method: 'GET', path: 'access/users', entry: lambdaEntry('project/get-project-access-users.ts') },
      { method: 'GET', path: 'access/my-projects', entry: lambdaEntry('project/get-user-project-access.ts') },
    ],
  };
}

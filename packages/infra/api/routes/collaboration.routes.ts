import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export function collaborationDomain(): DomainRoutes {
  return {
    basePath: 'collaboration',
    routes: [
      // Presence
      { method: 'GET',    path: 'get-presence',              entry: lambdaEntry('collaboration/get-presence.ts') },

      // Comments
      { method: 'POST',   path: 'create-comment',            entry: lambdaEntry('collaboration/create-comment.ts') },
      { method: 'GET',    path: 'get-comments',              entry: lambdaEntry('collaboration/get-comments.ts') },
      { method: 'PATCH',  path: 'update-comment/{commentId}', entry: lambdaEntry('collaboration/update-comment.ts') },
      { method: 'DELETE', path: 'delete-comment/{commentId}', entry: lambdaEntry('collaboration/delete-comment.ts') },

      // Assignments
      { method: 'PUT',    path: 'upsert-assignment',         entry: lambdaEntry('collaboration/upsert-assignment.ts') },
      { method: 'GET',    path: 'get-assignments',           entry: lambdaEntry('collaboration/get-assignments.ts') },

      // Activity Feed
      { method: 'GET',    path: 'get-activity',              entry: lambdaEntry('collaboration/get-activity-feed.ts') },
    ],
  };
}

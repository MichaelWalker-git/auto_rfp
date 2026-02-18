'use client';

import useSWRMutation from 'swr/mutation';
import { apiMutate, buildApiUrl, ApiError } from './api-helpers';

// Re-export useProject from use-api for backward compatibility
export { useProject } from './use-api';

/**
 * Note: useProject() GET hook is defined in use-api.ts to avoid circular deps.
 * This file contains project mutation hooks only.
 */

export function useDeleteProject() {
  return useSWRMutation<
    unknown,
    ApiError,
    string,
    { projectId: string; orgId: string }
  >(
    buildApiUrl('projects/delete'),
    async (url, { arg: { orgId, projectId } }) =>
      apiMutate(buildApiUrl(`projects/delete/${projectId}`, { orgId }), 'DELETE'),
  );
}

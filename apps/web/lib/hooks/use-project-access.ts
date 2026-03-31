'use client';

import useSWR, { mutate } from 'swr';
import { apiFetcher, apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { UserProjectAccess } from '@auto-rfp/core';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectAccessUsersResponse {
  users: UserProjectAccess[];
  projectId: string;
}

interface UserProjectAccessResponse {
  projects: UserProjectAccess[];
  userId: string;
}

interface AssignAccessRequest {
  orgId: string;
  userId: string;
  projectId: string;
}

interface RevokeAccessRequest {
  orgId: string;
  userId: string;
  projectId: string;
}

interface GrantAdminAccessRequest {
  orgId: string;
  projectId: string;
}

interface GrantAdminAccessResponse {
  projectId: string;
  grantedCount: number;
  skippedCount: number;
  adminUserIds: string[];
}

// ─── Hook: Get all users with access to a project ─────────────────────────────

export const useProjectAccessUsers = (orgId: string | undefined, projectId: string | undefined) => {
  const shouldFetch = !!orgId && !!projectId;
  const url = shouldFetch ? buildApiUrl('projects/access/users', { orgId, projectId }) : null;
  const key = shouldFetch ? ['project-access-users', orgId, projectId] : null;

  const { data, error, isLoading, mutate: revalidate } = useSWR<ProjectAccessUsersResponse>(
    key,
    url ? () => apiFetcher<ProjectAccessUsersResponse>(url) : null,
    {
      revalidateOnFocus: false,
    },
  );

  return {
    users: data?.users ?? [],
    projectId: data?.projectId,
    isLoading,
    error,
    revalidate,
  };
};

// ─── Hook: Get current user's project access ──────────────────────────────────

export const useMyProjectAccess = (orgId: string | undefined) => {
  const shouldFetch = !!orgId;
  const url = shouldFetch ? buildApiUrl('projects/access/my-projects', { orgId }) : null;
  const key = shouldFetch ? ['my-project-access', orgId] : null;

  const { data, error, isLoading, mutate: revalidate } = useSWR<UserProjectAccessResponse>(
    key,
    url ? () => apiFetcher<UserProjectAccessResponse>(url) : null,
    {
      revalidateOnFocus: false,
    },
  );

  return {
    projects: data?.projects ?? [],
    isLoading,
    error,
    revalidate,
  };
};

// ─── Hook: Assign user to project ─────────────────────────────────────────────

export const useAssignProjectAccess = () => {
  const assign = async (request: AssignAccessRequest) => {
    const { orgId, userId, projectId } = request;
    const url = buildApiUrl('projects/access/assign', { orgId });

    const result = await apiMutate<UserProjectAccess, { userId: string; projectId: string }>(
      url,
      'POST',
      { userId, projectId },
    );

    // Revalidate the project access list
    await mutate(['project-access-users', orgId, projectId]);

    return result;
  };

  return { assign };
};

// ─── Hook: Revoke user from project ───────────────────────────────────────────

export const useRevokeProjectAccess = () => {
  const revoke = async (request: RevokeAccessRequest) => {
    const { orgId, userId, projectId } = request;
    const url = buildApiUrl('projects/access/revoke', { orgId });

    const result = await apiMutate<{ ok: boolean; userId: string; projectId: string }, { userId: string; projectId: string }>(
      url,
      'POST',
      { userId, projectId },
    );

    // Revalidate the project access list
    await mutate(['project-access-users', orgId, projectId]);

    return result;
  };

  return { revoke };
};

// ─── Hook: Grant access to all org admins ─────────────────────────────────────

export const useGrantAdminAccess = () => {
  const grantToAdmins = async (request: GrantAdminAccessRequest): Promise<GrantAdminAccessResponse> => {
    const { orgId, projectId } = request;
    const url = buildApiUrl('projects/access/grant-admins', { orgId });

    const result = await apiMutate<GrantAdminAccessResponse, { projectId: string }>(
      url,
      'POST',
      { projectId },
    );

    // Revalidate the project access list
    await mutate(['project-access-users', orgId, projectId]);

    return result;
  };

  return { grantToAdmins };
};

// ─── Helper: Check if user can manage project access ──────────────────────────

export const canManageProjectAccess = (
  _users: UserProjectAccess[],
  _userId: string,
  _projectCreatorId: string | undefined,
  isOrgAdmin: boolean,
): boolean => {
  // Only org admins can manage project access
  // (Backend requires admin permission for assign/revoke endpoints)
  return isOrgAdmin;
};

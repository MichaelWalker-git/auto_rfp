import { useMemo } from 'react';
import { useUsersList } from './use-user';
import { useProjectAccessUsers } from './use-project-access';

interface EligibleReviewer {
  userId: string;
  displayName: string;
  email?: string;
  isAdmin: boolean;
}

/**
 * Get list of users eligible to review project content.
 * Returns users with project access + org admins, sorted with admins first.
 */
export const useEligibleReviewers = (
  orgId: string,
  projectId: string,
  currentUserId?: string,
) => {
  const { users: accessUsers, isLoading: isLoadingAccess } = useProjectAccessUsers(orgId, projectId);
  const { data: usersListResponse, isLoading: isLoadingUsers } = useUsersList(orgId, { status: 'ACTIVE', limit: 200 });
  const orgUsers = usersListResponse?.items ?? [];

  const eligibleReviewers = useMemo(() => {
    // Wait for both data sources to load to avoid showing incomplete list
    if (isLoadingAccess || isLoadingUsers) return [];

    const projectAccessUserIds = new Set(accessUsers.map((a) => a.userId));

    return orgUsers
      .filter((user) => {
        // Exclude current user
        if (currentUserId && user.userId === currentUserId) return false;

        // Include if has project access OR is an admin
        return projectAccessUserIds.has(user.userId) || user.role === 'ADMIN';
      })
      .map((user) => {
        // Match backend getUserDisplayName logic: trim displayName first
        const trimmedDisplayName = user.displayName?.trim();
        const firstName = user.firstName?.trim();
        const lastName = user.lastName?.trim();

        let displayName: string;
        if (trimmedDisplayName) {
          displayName = trimmedDisplayName;
        } else if (firstName && lastName) {
          displayName = `${firstName} ${lastName}`;
        } else if (firstName) {
          displayName = firstName;
        } else if (lastName) {
          displayName = lastName;
        } else {
          displayName = user.email || user.userId;
        }

        return {
          userId: user.userId,
          displayName,
          email: user.email,
          isAdmin: user.role === 'ADMIN',
        };
      })
      .sort((a, b) => {
        // Sort admins first, then alphabetically
        if (a.isAdmin && !b.isAdmin) return -1;
        if (!a.isAdmin && b.isAdmin) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [accessUsers, orgUsers, currentUserId, isLoadingAccess, isLoadingUsers]);

  return {
    eligibleReviewers,
    isLoading: isLoadingAccess || isLoadingUsers,
  };
};

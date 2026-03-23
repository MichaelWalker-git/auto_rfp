'use client';

import { useMemo } from 'react';
import { useKBAccessUsers } from '@/lib/hooks/use-user';
import { useAuth } from '@/components/AuthProvider';

/**
 * Hook to check if the current user can manage KB access.
 * User can manage if:
 * 1. Has 'admin' accessLevel on this KB (KB owner/creator), OR
 * 2. Has access to this KB AND is org ADMIN role
 */
export const useCanManageKBAccess = (kbId: string, orgId: string) => {
  const { userSub, role } = useAuth();
  const { data: accessData, isLoading } = useKBAccessUsers(kbId, orgId);

  const canManage = useMemo(() => {
    if (!userSub || !accessData?.users) return false;

    const currentUserAccessRecord = accessData.users.find((u) => u.userId === userSub);
    if (!currentUserAccessRecord) return false;

    const hasKBAdminAccess = currentUserAccessRecord.accessLevel === 'admin';
    const isOrgAdmin = role === 'ADMIN';
    const hasAccessToKB = !!currentUserAccessRecord;

    return hasKBAdminAccess || (hasAccessToKB && isOrgAdmin);
  }, [userSub, accessData, role]);

  return { canManage, isLoading };
};

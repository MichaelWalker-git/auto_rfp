'use client';
import { Permission } from '@auto-rfp/core';
import { useAuth } from '@/components/AuthProvider';

type Props = {
  requiredPermission: Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

const PermissionWrapper = ({ requiredPermission, children, fallback }: Props) => {
  const { orgId, permissions } = useAuth();

  if (!orgId || permissions && permissions.includes(requiredPermission)) {
    return (
      <>
        {children}
      </>
    );
  }

  return <>{fallback ?? null}</>;
};

export function usePermission(requiredPermission: Permission): boolean {
  const { orgId, permissions } = useAuth();
  return !orgId || (permissions && permissions.includes(requiredPermission)) || false;
}

export default PermissionWrapper;
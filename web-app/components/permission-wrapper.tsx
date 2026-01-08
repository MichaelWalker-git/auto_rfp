'use client';
import { Permission } from '@auto-rfp/shared';
import { useAuth } from '@/components/AuthProvider';

type Props = {
  requiredPermission: Permission;
  children: React.ReactNode;
}

const PermissionWrapper = ({ requiredPermission, children }: Props) => {
  const { orgId, permissions } = useAuth();

  if (!orgId || permissions && permissions.includes(requiredPermission)) {
    return (
      <>
        {children}
      </>
    );
  }

  return (<></>);
};

export default PermissionWrapper;
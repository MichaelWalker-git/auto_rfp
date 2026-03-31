'use client';

import { useState } from 'react';
import { useProjectAccessUsers, useAssignProjectAccess, useRevokeProjectAccess, useGrantAdminAccess, canManageProjectAccess } from '@/lib/hooks/use-project-access';
import { useUsersList } from '@/lib/hooks/use-user';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { UserPlus, Trash2, Users, Shield, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { UserListItem } from '@auto-rfp/core';

interface ProjectAccessManagerProps {
  orgId: string;
  projectId: string;
  projectCreatorId?: string;
}

export const ProjectAccessManager = ({ orgId, projectId, projectCreatorId }: ProjectAccessManagerProps) => {
  const { users: accessUsers, isLoading: loadingAccess, revalidate } = useProjectAccessUsers(orgId, projectId);
  const { data: usersListResponse, isLoading: loadingOrgUsers } = useUsersList(orgId, { limit: 200 });
  const orgUsers: UserListItem[] = usersListResponse?.items ?? [];
  const { userSub: currentUserId, role: userRole } = useAuth();
  const { assign } = useAssignProjectAccess();
  const { revoke } = useRevokeProjectAccess();
  const { grantToAdmins } = useGrantAdminAccess();

  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [isGrantingAdmins, setIsGrantingAdmins] = useState(false);
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);

  const isOrgAdmin = userRole === 'ADMIN';
  const canManage = currentUserId
    ? canManageProjectAccess(accessUsers, currentUserId, projectCreatorId, isOrgAdmin)
    : false;

  // Users who don't have access yet
  const assignedUserIds = new Set(accessUsers.map((u) => u.userId));
  const availableUsers = orgUsers.filter((u) => 
    !assignedUserIds.has(u.userId) && u.userId !== currentUserId
  );

  // Check if there are admins without access (for showing/hiding "Grant to All Admins" button)
  const adminsWithoutAccess = orgUsers.filter((u) => 
    u.role === 'ADMIN' && !assignedUserIds.has(u.userId)
  );
  const hasAdminsToGrant = adminsWithoutAccess.length > 0;

  const handleAssign = async () => {
    if (!selectedUserId) {
      toast.error('Please select a user');
      return;
    }

    setIsAssigning(true);
    try {
      await assign({ orgId, userId: selectedUserId, projectId });
      toast.success('User added to project');
      setSelectedUserId('');
      revalidate();
    } catch (err) {
      console.error('Failed to assign user:', err);
      toast.error('Failed to add user');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleRevoke = async (userId: string, userName: string) => {
    setRevokingUserId(userId);
    try {
      await revoke({ orgId, userId, projectId });
      toast.success(`Removed ${userName} from project`);
      revalidate();
    } catch (err) {
      console.error('Failed to revoke access:', err);
      toast.error('Failed to remove user');
    } finally {
      setRevokingUserId(null);
    }
  };

  const handleGrantToAdmins = async () => {
    setIsGrantingAdmins(true);
    try {
      const result = await grantToAdmins({ orgId, projectId });
      if (result.grantedCount > 0) {
        toast.success(`Granted access to ${result.grantedCount} admin(s)`);
      } else {
        toast.info('All admins already have access');
      }
      revalidate();
    } catch (err) {
      console.error('Failed to grant admin access:', err);
      toast.error('Failed to grant access to admins');
    } finally {
      setIsGrantingAdmins(false);
    }
  };

  if (loadingAccess || loadingOrgUsers) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Project Access
            </CardTitle>
            <CardDescription>Manage who can view and edit this project</CardDescription>
          </div>
          {canManage && hasAdminsToGrant && (
            <Button variant="outline" size="sm" onClick={handleGrantToAdmins} disabled={isGrantingAdmins}>
              <Shield className="h-4 w-4 mr-2" />
              {isGrantingAdmins ? 'Granting...' : 'Grant to All Admins'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Read-only info for non-admins */}
        {!canManage && (
          <div className="flex items-center gap-2 p-4 border rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm">
            <Shield className="h-4 w-4 shrink-0" />
            <span>Only organization admins can manage project access. Contact an admin to add or remove users.</span>
          </div>
        )}

        {/* Add User Section */}
        {canManage && (
          <div className="space-y-3 p-4 border rounded-lg bg-muted/50">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Add User
            </h4>
            <div className="flex gap-3">
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a user..." />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground">
                      {loadingOrgUsers
                        ? 'Loading users...'
                        : orgUsers.length <= 1
                          ? 'No other users in organization'
                          : 'All users already have access'}
                    </div>
                  ) : (
                    availableUsers.map((user) => (
                      <SelectItem key={user.userId} value={user.userId}>
                        {user.displayName || user.email} {user.role === 'ADMIN' && '(Org Admin)'}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>

              <Button onClick={handleAssign} disabled={isAssigning || !selectedUserId}>
                {isAssigning ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </div>
        )}

        {/* Current Access List */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Users with Access ({accessUsers.length})</h4>

          {accessUsers.length === 0 ? (
            <div className="flex items-center gap-2 p-4 border rounded-lg bg-muted/50 text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              <span>No users have access to this project.</span>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-lg border">
              {accessUsers.map((access) => {
                const user = orgUsers.find((u) => u.userId === access.userId);
                const isCreator = access.userId === projectCreatorId;
                const isCurrentUser = access.userId === currentUserId;

                return (
                  <div key={access.userId} className="flex items-center justify-between p-3 hover:bg-accent/50">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                        {(user?.displayName || user?.email || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-sm flex items-center gap-2">
                          {user?.displayName || user?.email || access.userId}
                          {isCreator && (
                            <Badge variant="outline" className="text-xs">
                              Creator
                            </Badge>
                          )}
                          {isCurrentUser && (
                            <Badge variant="secondary" className="text-xs">
                              You
                            </Badge>
                          )}
                          {user?.role === 'ADMIN' && (
                            <Badge className="text-xs bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400">
                              Org Admin
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{user?.email}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {canManage && !isCurrentUser && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleRevoke(access.userId, user?.displayName || user?.email || 'User')}
                          disabled={revokingUserId === access.userId}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

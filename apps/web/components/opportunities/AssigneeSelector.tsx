'use client';

import React from 'react';
import { Loader2, User } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProjectAccessUsers } from '@/lib/hooks/use-project-access';
import { useUsersList } from '@/lib/hooks/use-user';
import { useAssignOpportunity } from '@/lib/hooks/use-opportunity-assignment';
import { useAuth } from '@/components/AuthProvider';
import type { UserListItem } from '@auto-rfp/core';

interface AssigneeSelectorProps {
  orgId: string;
  projectId: string;
  oppId: string;
  currentAssigneeId?: string | null;
  currentAssigneeName?: string | null;
  onAssigned?: () => void;
  /** Size variant */
  size?: 'sm' | 'default';
  /** Whether to show "Assigned to:" label */
  showLabel?: boolean;
  className?: string;
}

export const AssigneeSelector = ({
  orgId,
  projectId,
  oppId,
  currentAssigneeId,
  currentAssigneeName,
  onAssigned,
  size = 'default',
  showLabel = false,
  className,
}: AssigneeSelectorProps) => {
  // Get users with project access
  const { users: accessUsers, isLoading: isLoadingAccess } = useProjectAccessUsers(orgId, projectId);
  // Get full user details from org
  const { data: usersListResponse, isLoading: isLoadingOrgUsers } = useUsersList(orgId, { limit: 200 });
  const orgUsers: UserListItem[] = usersListResponse?.items ?? [];
  
  const { assign, isAssigning } = useAssignOpportunity();
  const { userSub } = useAuth();

  // Build list of assignable users
  // If project has explicit access records, use those users
  // Otherwise (legacy projects), show all org users
  const assignableUsers = accessUsers.length > 0
    ? accessUsers.map(access => {
        const userDetails = orgUsers.find(u => u.userId === access.userId);
        return {
          userId: access.userId,
          displayName: userDetails?.displayName || [userDetails?.firstName, userDetails?.lastName].filter(Boolean).join(' ') || userDetails?.email,
          email: userDetails?.email,
        };
      })
    : orgUsers.map(user => ({
        userId: user.userId,
        displayName: user.displayName || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
        email: user.email,
      }));

  const isLoading = isLoadingAccess || isLoadingOrgUsers;

  const handleValueChange = async (value: string) => {
    const assigneeId = value === 'unassigned' ? null : value;
    try {
      await assign({ orgId, projectId, oppId, assigneeId });
      onAssigned?.();
    } catch {
      // Error handled by hook
    }
  };

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 text-muted-foreground ${className ?? ''}`}>
        {showLabel && <span className="text-xs">Assigned to:</span>}
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    );
  }

  const triggerClassName = size === 'sm' 
    ? 'h-7 text-xs min-w-[120px] max-w-[180px]' 
    : 'h-9 text-sm min-w-[150px] max-w-[220px]';

  return (
    <div 
      className={`flex items-center gap-2 ${className ?? ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      {showLabel && (
        <span className="text-xs text-muted-foreground whitespace-nowrap">Assigned to:</span>
      )}
      <Select
        value={currentAssigneeId || 'unassigned'}
        onValueChange={handleValueChange}
        disabled={isAssigning}
      >
        <SelectTrigger className={triggerClassName}>
          {isAssigning ? (
            <div className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Saving...</span>
            </div>
          ) : (
            <SelectValue placeholder="Select assignee..." />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unassigned">
            <span className="text-muted-foreground">Unassigned</span>
          </SelectItem>
          {assignableUsers.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No team members found
            </div>
          ) : (
            assignableUsers.map((user) => {
              const isCurrentUser = user.userId === userSub;
              return (
                <SelectItem key={user.userId} value={user.userId}>
                  <span className="flex items-center gap-1.5">
                    <User className="h-3 w-3 shrink-0" />
                    {user.displayName || user.email || user.userId}
                    {isCurrentUser && (
                      <span className="text-muted-foreground text-xs">(you)</span>
                    )}
                  </span>
                </SelectItem>
              );
            })
          )}
        </SelectContent>
      </Select>
    </div>
  );
};

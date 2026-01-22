'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, TrashIcon } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TeamMember } from './types';
import { deleteUserApi, editUserRolesApi } from '@/lib/hooks/use-user';
import type { UserRole } from '@auto-rfp/shared';

interface MemberActionsDropdownProps {
  member: TeamMember;
  orgId: string;
  onMemberUpdated: (updatedMember: TeamMember) => void;
  onMemberRemoved: (memberId: string) => void;
}

function userRoleLabel(role: UserRole) {
  switch (role) {
    case 'ADMIN':
      return 'Admin';
    case 'EDITOR':
      return 'Editor';
    case 'VIEWER':
      return 'Viewer';
    case 'BILLING':
      return 'Billing';
  }
}

export function MemberActionsDropdown({
                                        member,
                                        orgId,
                                        onMemberUpdated,
                                        onMemberRemoved,
                                      }: MemberActionsDropdownProps) {
  const { toast } = useToast();
  const [isRemoving, setIsRemoving] = useState(false);
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);

  const handleRemoveMember = async () => {
    if (isRemoving) return;

    try {
      setIsRemoving(true);

      await deleteUserApi({
        orgId,
        userId: member.id,
      });

      onMemberRemoved(member.id);

      toast({
        title: 'Success',
        description: 'Team member removed',
      });
    } catch (error) {
      console.error('Error removing member:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to remove team member',
        variant: 'destructive',
      });
    } finally {
      setIsRemoving(false);
    }
  };

  const updateMemberRole = async (newRole: UserRole) => {
    if (isUpdatingRole) return;

    try {
      setIsUpdatingRole(true);

      const res = await editUserRolesApi({
        orgId,
        userId: member.id,
        role: newRole,
      });

      onMemberUpdated({ ...member, role: res.role });

      toast({
        title: 'Success',
        description: 'Member role updated',
      });
    } catch (error) {
      console.error('Error updating member role:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update member role',
        variant: 'destructive',
      });
    } finally {
      setIsUpdatingRole(false);
    }
  };

  const currentRole = member.role as unknown as UserRole;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={isRemoving || isUpdatingRole}>
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => updateMemberRole('ADMIN')}
          disabled={currentRole === 'ADMIN' || isUpdatingRole || isRemoving}
        >
          Make {userRoleLabel('ADMIN')}
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => updateMemberRole('EDITOR')}
          disabled={currentRole === 'EDITOR' || isUpdatingRole || isRemoving}
        >
          Make {userRoleLabel('EDITOR')}
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => updateMemberRole('VIEWER')}
          disabled={currentRole === 'VIEWER' || isUpdatingRole || isRemoving}
        >
          Make {userRoleLabel('VIEWER')}
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => updateMemberRole('BILLING')}
          disabled={currentRole === 'BILLING' || isUpdatingRole || isRemoving}
        >
          Make {userRoleLabel('BILLING')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={handleRemoveMember}
          disabled={isRemoving || isUpdatingRole}
        >
          <TrashIcon className="h-4 w-4 mr-2" />
          {isRemoving ? 'Removing…' : 'Remove from team'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
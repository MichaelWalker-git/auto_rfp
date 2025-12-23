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

interface MemberActionsDropdownProps {
  member: TeamMember;
  orgId: string;
  onMemberUpdated: (updatedMember: TeamMember) => void;
  onMemberRemoved: (memberId: string) => void;
}

function roleToApiRoles(role: TeamMember['role']): string[] {
  // Your TeamMember roles are 'owner' | 'admin' | 'member'
  // Your API expects string[] (e.g. ['ADMIN'] | ['MEMBER'])
  switch (role) {
    case 'admin':
      return ['ADMIN'];
    case 'member':
      return ['MEMBER'];
    case 'owner':
      return ['OWNER'];
    default:
      return ['MEMBER'];
  }
}

function apiRolesToTeamRole(roles: string[] | undefined): TeamMember['role'] {
  const set = new Set((roles ?? []).map((r) => r.toUpperCase()));
  if (set.has('OWNER')) return 'owner';
  if (set.has('ADMIN')) return 'admin';
  return 'member';
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

  const updateMemberRole = async (newRole: 'admin' | 'member') => {
    if (isUpdatingRole) return;

    try {
      setIsUpdatingRole(true);

      const res = await editUserRolesApi({
        orgId,
        userId: member.id,
        roles: roleToApiRoles(newRole),
      });

      const updatedRole = apiRolesToTeamRole(res.roles);

      onMemberUpdated({ ...member, role: updatedRole });

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

  // Don't show actions for owners
  if (member.role === 'owner') return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={isRemoving || isUpdatingRole}>
          <MoreHorizontal className="h-4 w-4"/>
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator/>

        <DropdownMenuItem
          onClick={() => updateMemberRole('admin')}
          disabled={member.role === 'admin' || isUpdatingRole || isRemoving}
        >
          Make Admin
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => updateMemberRole('member')}
          disabled={member.role === 'member' || isUpdatingRole || isRemoving}
        >
          Make Member
        </DropdownMenuItem>

        <DropdownMenuSeparator/>

        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={handleRemoveMember}
          disabled={isRemoving || isUpdatingRole}
        >
          <TrashIcon className="h-4 w-4 mr-2"/>
          {isRemoving ? 'Removing…' : 'Remove from team'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
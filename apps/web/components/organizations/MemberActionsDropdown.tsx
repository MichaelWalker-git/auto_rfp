'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDeleteDialog } from '@/components/ui/confirm-delete-dialog';
import { MoreHorizontal, UserX, Pencil } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { deleteUserApi } from '@/lib/hooks/use-user';
import type { TeamMember } from './types';

interface MemberActionsDropdownProps {
  member: TeamMember;
  orgId: string;
  onMemberUpdated: (member: TeamMember) => void;
  onMemberRemoved: (memberId: string) => void;
}

export function MemberActionsDropdown({
  member,
  orgId,
  onMemberUpdated,
  onMemberRemoved,
}: MemberActionsDropdownProps) {
  const { toast } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleDelete = useCallback(async () => {
    try {
      await deleteUserApi({ orgId, userId: member.id });
      toast({ title: 'User removed' });
      onMemberRemoved(member.id);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to remove user';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  }, [orgId, member.id, onMemberRemoved, toast]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/organizations/${orgId}/team/${member.id}`} className="flex items-center">
              <Pencil className="mr-2 h-4 w-4" />
              Edit User
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <UserX className="mr-2 h-4 w-4" />
            Remove User
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDeleteDialog
        isOpen={deleteOpen}
        onOpenChange={setDeleteOpen}
        itemName={member.email}
        itemType="user"
        title="Remove User"
        description={`Are you sure you want to remove ${member.email}? This cannot be undone.`}
        onConfirm={handleDelete}
        confirmLabel="Remove"
      />
    </>
  );
}

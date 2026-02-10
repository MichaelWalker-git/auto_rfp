'use client';

import React, { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { MoreHorizontal, UserX, Pencil } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { UserRoleSchema, type UserRole } from '@auto-rfp/shared';
import { editUserApi, deleteUserApi } from '@/lib/hooks/use-user';
import type { TeamMember } from './types';

const ROLE_OPTIONS = UserRoleSchema.options;

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

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState<UserRole>(member.role as UserRole);
  const [editBusy, setEditBusy] = useState(false);

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const openEditDialog = () => {
    setEditFirstName(member.firstName ?? '');
    setEditLastName(member.lastName ?? '');
    setEditPhone(member.phone ?? '');
    setEditRole(member.role as UserRole);
    setEditOpen(true);
  };

  const handleEdit = useCallback(async () => {
    setEditBusy(true);
    try {
      const payload: Record<string, string | undefined> = {
        orgId,
        userId: member.id,
      };

      // Send all editable fields
      if (editFirstName.trim()) payload.firstName = editFirstName.trim();
      if (editLastName.trim()) payload.lastName = editLastName.trim();
      if (editPhone.trim()) payload.phone = editPhone.trim();
      if (editRole !== member.role) payload.role = editRole;

      await editUserApi(payload as any);
      toast({ title: 'User updated' });

      const newName =
        [editFirstName.trim(), editLastName.trim()].filter(Boolean).join(' ') ||
        member.email ||
        'Unknown';

      onMemberUpdated({
        ...member,
        firstName: editFirstName.trim() || undefined,
        lastName: editLastName.trim() || undefined,
        phone: editPhone.trim() || undefined,
        role: editRole,
        name: newName,
      });
      setEditOpen(false);
    } catch (e: any) {
      toast({
        title: 'Error',
        description: e?.message ?? 'Failed to update user',
        variant: 'destructive',
      });
    } finally {
      setEditBusy(false);
    }
  }, [orgId, member, editFirstName, editLastName, editPhone, editRole, onMemberUpdated, toast]);

  const handleDelete = useCallback(async () => {
    setDeleteBusy(true);
    try {
      await deleteUserApi({ orgId, userId: member.id });
      toast({ title: 'User removed' });
      onMemberRemoved(member.id);
      setDeleteOpen(false);
    } catch (e: any) {
      toast({
        title: 'Error',
        description: e?.message ?? 'Failed to remove user',
        variant: 'destructive',
      });
    } finally {
      setDeleteBusy(false);
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
          <DropdownMenuItem onClick={openEditDialog}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit User
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

      {/* Edit User Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update details for {member.email}. Email cannot be changed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* Email (read-only) */}
            <div className="grid gap-2">
              <Label htmlFor={`edit-email-${member.id}`}>Email</Label>
              <Input
                id={`edit-email-${member.id}`}
                type="email"
                value={member.email}
                disabled
                className="bg-muted"
              />
            </div>

            {/* First Name / Last Name */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`edit-fn-${member.id}`}>First Name</Label>
                <Input
                  id={`edit-fn-${member.id}`}
                  placeholder="John"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`edit-ln-${member.id}`}>Last Name</Label>
                <Input
                  id={`edit-ln-${member.id}`}
                  placeholder="Doe"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                />
              </div>
            </div>

            {/* Phone */}
            <div className="grid gap-2">
              <Label htmlFor={`edit-ph-${member.id}`}>Phone</Label>
              <Input
                id={`edit-ph-${member.id}`}
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
              />
            </div>

            {/* Role */}
            <div className="grid gap-2">
              <Label>Role</Label>
              <Select value={editRole} onValueChange={(v) => setEditRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={editBusy}>
              {editBusy ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{member.email}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleteBusy}
            >
              {deleteBusy ? 'Removing…' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { UserPlus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { UserRole, UserRoleSchema } from '@auto-rfp/shared';

import type { TeamMember } from './types';
import { createUserApi } from '@/lib/hooks/use-user';
import PermissionWrapper from '@/components/permission-wrapper';

interface InviteMemberDialogProps {
  orgId: string;
  onMemberAdded: (member: TeamMember) => void;
}

export function InviteMemberDialog({ orgId, onMemberAdded }: InviteMemberDialogProps) {
  const [open, setOpen] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('VIEWER');
  const [isInviting, setIsInviting] = useState(false);

  const { toast } = useToast();

  const handleInviteMember = async (event: React.FormEvent) => {
    event.preventDefault();

    const email = inviteEmail.trim();
    if (!email) {
      toast({ title: 'Error', description: 'Email is required', variant: 'destructive' });
      return;
    }

    try {
      setIsInviting(true);

      const created = await createUserApi({
        orgId,
        email,
        role: inviteRole,
        status: 'INVITED', // optional; your create lambda defaults to ACTIVE if omitted
      });

      const newMember: TeamMember = {
        id: created.userId,
        name:
          created.displayName ||
          [created.firstName, created.lastName].filter(Boolean).join(' ') ||
          created.email.split('@')[0],
        email: created.email,
        role: inviteRole,
        joinedAt: created.createdAt,
        avatarUrl: undefined,
      };

      onMemberAdded(newMember);

      toast({
        title: 'Success',
        description: `User created: ${created.email}`,
      });

      setInviteEmail('');
      setInviteRole('VIEWER');
      setOpen(false);
    } catch (error) {
      console.error('Error creating user:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create user',
        variant: 'destructive',
      });
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <PermissionWrapper requiredPermission={'user:create'}>
          <Button>
            <UserPlus className="mr-2 h-4 w-4"/>
            Create User
          </Button>
        </PermissionWrapper>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
          <DialogDescription>Create a user in your organization.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleInviteMember}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Enter email address"
                autoComplete="email"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as UserRole)}
              >
                {UserRoleSchema.options.map((r) => (
                  <option key={r} value={r}>
                    {r[0] + r.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isInviting}>
              {isInviting ? 'Creating...' : 'Create User'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
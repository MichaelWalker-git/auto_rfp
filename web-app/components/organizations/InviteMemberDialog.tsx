'use client';

import React, { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { UserRoleSchema, type UserRole } from '@auto-rfp/shared';
import { createUserApi } from '@/lib/hooks/use-user';
import type { TeamMember } from './types';

const ROLE_OPTIONS = UserRoleSchema.options;

interface InviteMemberDialogProps {
  orgId: string;
  onMemberAdded: (member: TeamMember) => void;
}

export function InviteMemberDialog({ orgId, onMemberAdded }: InviteMemberDialogProps) {
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<UserRole>('VIEWER');
  const [busy, setBusy] = useState(false);

  const resetForm = () => {
    setEmail('');
    setFirstName('');
    setLastName('');
    setRole('VIEWER');
  };

  const handleInvite = useCallback(async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const res = await createUserApi({
        orgId,
        email: email.trim(),
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        role,
      });

      const name =
        res.displayName ||
        [res.firstName, res.lastName].filter(Boolean).join(' ') ||
        res.email;

      const newMember: TeamMember = {
        id: res.userId,
        name,
        email: res.email,
        firstName: res.firstName,
        lastName: res.lastName,
        role: res.role,
        joinedAt: res.createdAt,
      };

      onMemberAdded(newMember);
      toast({ title: 'User created' });
      resetForm();
      setOpen(false);
    } catch (e: any) {
      toast({
        title: 'Error',
        description: e?.message ?? 'Failed to create user',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  }, [orgId, email, firstName, lastName, role, onMemberAdded, toast]);

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create User
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create User</DialogTitle>
          <DialogDescription>Create a new team member.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="inv-email">Email</Label>
            <Input
              id="inv-email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="inv-firstName">First Name</Label>
              <Input
                id="inv-firstName"
                placeholder="John"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="inv-lastName">Last Name</Label>
              <Input
                id="inv-lastName"
                placeholder="Doe"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
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
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleInvite} disabled={busy || !email.trim()}>
            {busy ? 'Creating…' : 'Create User'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
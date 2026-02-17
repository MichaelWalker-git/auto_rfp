'use client';

import React, { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Label } from '@/components/ui/label';
import { Building2, Loader2, Plus, X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { UserRoleSchema, type UserRole } from '@auto-rfp/shared';
import { addUserToOrganizationApi, removeUserFromOrganizationApi } from '@/lib/hooks/use-user';
import { useOrganizations } from '@/lib/hooks/use-api';
import type { TeamMember } from './types';

const ROLE_OPTIONS = UserRoleSchema.options;

interface ManageUserOrgsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMember;
  currentOrgId: string;
}

export function ManageUserOrgsDialog({
  open,
  onOpenChange,
  member,
  currentOrgId,
}: ManageUserOrgsDialogProps) {
  const { toast } = useToast();
  const { data: allOrgs = [] } = useOrganizations();

  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('VIEWER');
  const [isAdding, setIsAdding] = useState(false);
  const [isRemoving, setIsRemoving] = useState<string | null>(null);

  // TODO: In a full implementation, we'd fetch the user's current org memberships
  // via a dedicated endpoint. For now, we show the add/remove UI.

  const handleAddToOrg = useCallback(async () => {
    if (!selectedOrgId) return;
    setIsAdding(true);
    try {
      await addUserToOrganizationApi({
        userId: member.id,
        targetOrgId: selectedOrgId,
        role: selectedRole,
      });
      toast({
        title: 'Success',
        description: `${member.email} added to organization`,
      });
      setSelectedOrgId('');
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err?.message ?? 'Failed to add user to organization',
        variant: 'destructive',
      });
    } finally {
      setIsAdding(false);
    }
  }, [member, selectedOrgId, selectedRole, toast]);

  const handleRemoveFromOrg = useCallback(async (targetOrgId: string) => {
    setIsRemoving(targetOrgId);
    try {
      await removeUserFromOrganizationApi({
        userId: member.id,
        targetOrgId,
      });
      toast({
        title: 'Success',
        description: `${member.email} removed from organization`,
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err?.message ?? 'Failed to remove user from organization',
        variant: 'destructive',
      });
    } finally {
      setIsRemoving(null);
    }
  }, [member, toast]);

  // Filter out the current org from the "add to" dropdown
  const availableOrgs = allOrgs.filter((o) => o.id !== currentOrgId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Manage Organizations
          </DialogTitle>
          <DialogDescription>
            Add or remove <strong>{member.email}</strong> from organizations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Current org membership */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-muted-foreground">Current Organization</Label>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">
                  {allOrgs.find((o) => o.id === currentOrgId)?.name || currentOrgId}
                </span>
                <Badge variant="secondary" className="text-xs">{member.role}</Badge>
              </div>
              <Badge variant="outline" className="text-xs">Current</Badge>
            </div>
          </div>

          {/* Add to another org */}
          <div className="space-y-3">
            <Label className="text-sm font-medium text-muted-foreground">Add to Organization</Label>
            <div className="flex gap-2">
              <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select organization..." />
                </SelectTrigger>
                <SelectContent>
                  {availableOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                  {availableOrgs.length === 0 && (
                    <SelectItem value="_none" disabled>
                      No other organizations available
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as UserRole)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleAddToOrg}
              disabled={!selectedOrgId || isAdding}
              size="sm"
              className="w-full"
            >
              {isAdding ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Adding...</>
              ) : (
                <><Plus className="h-4 w-4 mr-2" /> Add to Organization</>
              )}
            </Button>
          </div>

          {/* Remove from other orgs */}
          {availableOrgs.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">Remove from Organization</Label>
              <p className="text-xs text-muted-foreground">
                Click the X button to remove this user from an organization they belong to.
              </p>
              <div className="space-y-2">
                {availableOrgs.map((org) => (
                  <div
                    key={org.id}
                    className="flex items-center justify-between rounded-lg border border-dashed p-3"
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{org.name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFromOrg(org.id)}
                      disabled={isRemoving === org.id}
                      className="text-destructive hover:text-destructive"
                    >
                      {isRemoving === org.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

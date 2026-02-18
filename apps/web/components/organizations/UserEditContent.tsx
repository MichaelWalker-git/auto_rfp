'use client';

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Building2, Database, Loader2, Plus, Save, Trash2, X } from 'lucide-react';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { PageHeader } from '@/components/layout/page-header';
import { ConfirmDeleteDialog, useConfirmDelete } from '@/components/ui/confirm-delete-dialog';

import {
  editUserApi,
  deleteUserApi,
  addUserToOrganizationApi,
  removeUserFromOrganizationApi,
  useUsersList,
  useUserKBAccess,
  grantKBAccessApi,
  revokeKBAccessApi,
} from '@/lib/hooks/use-user';
import { useOrganizations } from '@/lib/hooks/use-api';
import { useKnowledgeBases } from '@/lib/hooks/use-knowledgebase';
import { invalidateKBAccessCaches } from '@/lib/helpers/kb-access-cache';
import { UserRoleSchema, type UserRole, type KnowledgeBase } from '@auto-rfp/core';
import PermissionWrapper from '@/components/permission-wrapper';

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

interface UserEditContentProps {
  orgId: string;
  userId: string;
}

const ROLE_OPTIONS = UserRoleSchema.options;

// ────────────────────────────────────────────
// Component
// ────────────────────────────────────────────

export function UserEditContent({ orgId, userId }: UserEditContentProps) {
  const { toast } = useToast();

  // Fetch user data
  const { data: usersData, mutate: refreshUsers } = useUsersList(orgId, { limit: 200 });
  const user = useMemo(
    () => usersData?.items?.find((u) => u.userId === userId),
    [usersData, userId],
  );

  // User edit form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('MEMBER' as UserRole);
  const [isSaving, setIsSaving] = useState(false);
  const [isFormInitialized, setIsFormInitialized] = useState(false);

  // Initialize form when user data loads
  React.useEffect(() => {
    if (user && !isFormInitialized) {
      setFirstName(user.firstName ?? '');
      setLastName(user.lastName ?? '');
      setPhone(user.phone ?? '');
      setRole(user.role as UserRole);
      setIsFormInitialized(true);
    }
  }, [user, isFormInitialized]);

  // KB access
  const { data: allKBs = [], isLoading: isLoadingKBs } = useKnowledgeBases(orgId);
  const { data: accessData, isLoading: isLoadingAccess } = useUserKBAccess(userId, orgId);
  const [mutatingKbId, setMutatingKbId] = useState<string | null>(null);

  const grantedKBIds = useMemo(() => {
    const ids = new Set<string>();
    for (const record of accessData?.records ?? []) ids.add(record.kbId);
    return ids;
  }, [accessData]);

  // ── Handlers ───────────────────────────────

  const handleSaveUser = useCallback(async () => {
    setIsSaving(true);
    try {
      const payload: Record<string, string | undefined> = { orgId, userId };
      if (firstName.trim()) payload.firstName = firstName.trim();
      if (lastName.trim()) payload.lastName = lastName.trim();
      if (phone.trim()) payload.phone = phone.trim();
      if (role !== user?.role) payload.role = role;

      await editUserApi(payload as any);
      await refreshUsers();
      toast({ title: 'User updated', description: 'User details saved successfully.' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update user';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [orgId, userId, firstName, lastName, phone, role, user?.role, refreshUsers, toast]);

  const handleGrantKB = useCallback(async (kbId: string) => {
    setMutatingKbId(kbId);
    try {
      await grantKBAccessApi({ userId, kbId, orgId, accessLevel: 'read' });
      invalidateKBAccessCaches(userId, kbId);
      toast({ title: 'Access granted' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to grant access';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setMutatingKbId(null);
    }
  }, [userId, orgId, toast]);

  const handleRevokeKB = useCallback(async (kbId: string) => {
    setMutatingKbId(kbId);
    try {
      await revokeKBAccessApi({ userId, kbId, orgId });
      invalidateKBAccessCaches(userId, kbId);
      toast({ title: 'Access revoked' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to revoke access';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setMutatingKbId(null);
    }
  }, [userId, orgId, toast]);

  // ── Early returns ──────────────────────────

  if (!user) {
    return (
      <div className="container mx-auto p-12">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const displayName = user.displayName || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;

  // ── Render ─────────────────────────────────

  return (
    <div className="container mx-auto p-12 space-y-6">
      <PageHeader
        title={displayName}
        description={user.email}
      />

      {/* Section 1: User Details */}
      <Card>
        <CardHeader>
          <CardTitle>User Details</CardTitle>
          <CardDescription>Update user profile information and role</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6">
            {/* Email (read-only) */}
            <div className="grid gap-2">
              <Label>Email</Label>
              <Input value={user.email} disabled className="bg-muted" />
            </div>

            {/* First Name / Last Name */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>

            {/* Phone */}
            <div className="grid gap-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            {/* Role */}
            <div className="grid gap-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <PermissionWrapper requiredPermission="user:edit">
            <Button onClick={handleSaveUser} disabled={isSaving}>
              {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : <><Save className="h-4 w-4 mr-2" /> Save Changes</>}
            </Button>
          </PermissionWrapper>
        </CardFooter>
      </Card>

      {/* Section 2: Organization Access */}
      <PermissionWrapper requiredPermission="user:edit">
        <OrganizationAccessSection userId={userId} orgId={orgId} email={user.email} />
      </PermissionWrapper>

      {/* Section 3: Knowledge Base Access */}
      <PermissionWrapper requiredPermission="kb:edit">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Knowledge Base Access
            </CardTitle>
            <CardDescription>
              Control which knowledge bases this user can access ({grantedKBIds.size} of {allKBs.length} granted)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingKBs || isLoadingAccess ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : allKBs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No knowledge bases found in this organization.
              </p>
            ) : (
              <div className="space-y-2">
                {allKBs.map((kb: KnowledgeBase) => {
                  const hasAccess = grantedKBIds.has(kb.id);
                  const isMutating = mutatingKbId === kb.id;

                  return (
                    <div
                      key={kb.id}
                      className={`flex items-center justify-between rounded-lg border p-3 ${
                        hasAccess ? 'border-primary/50 bg-primary/5' : 'border-dashed'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Database className={`h-4 w-4 ${hasAccess ? 'text-primary' : 'text-muted-foreground'}`} />
                        <div>
                          <p className="text-sm font-medium">{kb.name}</p>
                          {kb.description && <p className="text-xs text-muted-foreground">{kb.description}</p>}
                        </div>
                        <Badge variant={hasAccess ? 'default' : 'outline'} className="text-xs">
                          {kb.type === 'CONTENT_LIBRARY' ? 'Q&A' : 'Documents'}
                        </Badge>
                      </div>
                      {hasAccess ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeKB(kb.id)}
                          disabled={!!mutatingKbId}
                          className="text-destructive hover:text-destructive"
                        >
                          {isMutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleGrantKB(kb.id)}
                          disabled={!!mutatingKbId}
                        >
                          {isMutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Grant</>}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </PermissionWrapper>
      {/* Section 4: Danger Zone */}
      <PermissionWrapper requiredPermission="user:delete">
        <DangerZoneSection userId={userId} orgId={orgId} email={user.email} />
      </PermissionWrapper>
    </div>
  );
}

// ────────────────────────────────────────────
// Organization Access Section
// ────────────────────────────────────────────

function OrganizationAccessSection({ userId, orgId, email }: { userId: string; orgId: string; email: string }) {
  const { toast } = useToast();
  const { data: allOrgs = [] } = useOrganizations();
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [isMutating, setIsMutating] = useState(false);

  // For simplicity, we show all orgs; the user may already belong to some
  const handleAddToOrg = useCallback(async () => {
    if (!selectedOrgId) return;
    setIsMutating(true);
    try {
      await addUserToOrganizationApi({ userId, targetOrgId: selectedOrgId, orgId });
      toast({ title: 'Added to organization' });
      setSelectedOrgId('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add user';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsMutating(false);
    }
  }, [userId, selectedOrgId, orgId, toast]);

  const handleRemoveFromOrg = useCallback(async (targetOrgId: string) => {
    setIsMutating(true);
    try {
      await removeUserFromOrganizationApi({ userId, targetOrgId, orgId });
      toast({ title: 'Removed from organization' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove user';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsMutating(false);
    }
  }, [userId, orgId, toast]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Organization Access
        </CardTitle>
        <CardDescription>
          Manage which organizations {email} belongs to
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add to organization */}
        <div className="flex items-center gap-2">
          <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select organization to add..." />
            </SelectTrigger>
            <SelectContent>
              {allOrgs.length === 0 ? (
                <SelectItem value="_none" disabled>No organizations available</SelectItem>
              ) : (
                allOrgs.map((org: any) => (
                  <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button onClick={handleAddToOrg} disabled={!selectedOrgId || isMutating}>
            {isMutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Add</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────
// Danger Zone Section
// ────────────────────────────────────────────

function DangerZoneSection({ userId, orgId, email }: { userId: string; orgId: string; email: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const handleDelete = useCallback(async () => {
    try {
      await deleteUserApi({ orgId, userId });
      toast({ title: 'User removed', description: `${email} has been removed from the organization.` });
      router.push(`/organizations/${orgId}/team`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove user';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  }, [orgId, userId, email, toast, router]);

  return (
    <>
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>Irreversible actions</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Remove User</AlertTitle>
            <AlertDescription>
              Removing {email} will revoke all access to this organization, including projects, knowledge bases, and team features.
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>
          <Button variant="destructive" onClick={() => setIsDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 mr-2" />
            Remove User
          </Button>
        </CardFooter>
      </Card>

      <ConfirmDeleteDialog
        isOpen={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        itemName={email}
        itemType="user"
        title="Remove User"
        description={`Are you sure you want to remove ${email}? This will revoke all their access to this organization.`}
        onConfirm={handleDelete}
        confirmLabel="Remove"
      />
    </>
  );
}

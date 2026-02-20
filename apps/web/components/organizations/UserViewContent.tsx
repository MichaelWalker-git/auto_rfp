'use client';

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Calendar,
  Check,
  Database,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Plus,
  Shield,
  Trash2,
  User,
  X,
} from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDeleteDialog } from '@/components/ui/confirm-delete-dialog';
import { PageHeader } from '@/components/layout/page-header';
import PermissionWrapper, { usePermission } from '@/components/permission-wrapper';

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
import { formatDate } from '@/components/brief/helpers';

// ────────────────────────────────────────────
// Types & Constants
// ────────────────────────────────────────────

interface UserViewContentProps {
  orgId: string;
  userId: string;
}

const ROLE_OPTIONS = UserRoleSchema.options;

const ROLE_BADGE_MAP: Record<string, { variant: 'default' | 'secondary' | 'outline'; label: string }> = {
  ADMIN: { variant: 'default', label: 'Admin' },
  BILLING: { variant: 'default', label: 'Owner' },
  EDITOR: { variant: 'secondary', label: 'Editor' },
  VIEWER: { variant: 'outline', label: 'Viewer' },
  MEMBER: { variant: 'outline', label: 'Member' },
};

const STATUS_BADGE_MAP: Record<string, { variant: 'default' | 'secondary' | 'outline' | 'destructive'; label: string }> = {
  ACTIVE: { variant: 'default', label: 'Active' },
  INACTIVE: { variant: 'outline', label: 'Inactive' },
  INVITED: { variant: 'secondary', label: 'Invited' },
  SUSPENDED: { variant: 'destructive', label: 'Suspended' },
};

// ────────────────────────────────────────────
// Main Component
// ────────────────────────────────────────────

export function UserViewContent({ orgId, userId }: UserViewContentProps) {
  const { toast } = useToast();
  const canEdit = usePermission('user:edit');

  // Fetch user data
  const { data: usersData, mutate: refreshUsers, isLoading } = useUsersList(orgId, { limit: 200 });
  const user = useMemo(
    () => usersData?.items?.find((u) => u.userId === userId),
    [usersData, userId],
  );

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('MEMBER' as UserRole);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize / reset form from user data
  const resetForm = useCallback(() => {
    if (!user) return;
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
    setPhone(user.phone ?? '');
    setRole(user.role as UserRole);
  }, [user]);

  const handleStartEditing = useCallback(() => {
    resetForm();
    setIsEditing(true);
  }, [resetForm]);

  const handleCancelEditing = useCallback(() => {
    resetForm();
    setIsEditing(false);
  }, [resetForm]);

  const handleSaveUser = useCallback(async () => {
    setIsSaving(true);
    try {
      const payload: Record<string, string | undefined> = { orgId, userId };
      if (firstName.trim()) payload.firstName = firstName.trim();
      if (lastName.trim()) payload.lastName = lastName.trim();
      if (phone.trim()) payload.phone = phone.trim();
      if (role !== user?.role) payload.role = role;

      await editUserApi(payload as Parameters<typeof editUserApi>[0]);
      await refreshUsers();
      toast({ title: 'User updated', description: 'User details saved successfully.' });
      setIsEditing(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update user';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [orgId, userId, firstName, lastName, phone, role, user?.role, refreshUsers, toast]);

  // ── Loading / not found states ─────────────

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-4xl p-6 md:p-12 space-y-6">
        <Skeleton className="h-5 w-28" />
        <div className="flex items-start gap-6">
          <Skeleton className="h-20 w-20 rounded-full shrink-0" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          </div>
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto max-w-4xl p-6 md:p-12 space-y-6">
        <Link
          href={`/organizations/${orgId}/team`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Team
        </Link>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <User className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h2 className="text-lg font-semibold">User not found</h2>
            <p className="text-sm text-muted-foreground mt-1">
              This user may have been removed or you don&apos;t have permission to view them.
            </p>
            <Button variant="outline" className="mt-6" asChild>
              <Link href={`/organizations/${orgId}/team`}>Return to Team</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const displayName =
    user.displayName ||
    [user.firstName, user.lastName].filter(Boolean).join(' ') ||
    user.email;
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const roleConfig = ROLE_BADGE_MAP[user.role] ?? ROLE_BADGE_MAP.MEMBER;
  const statusConfig = STATUS_BADGE_MAP[user.status ?? 'ACTIVE'] ?? STATUS_BADGE_MAP.ACTIVE;

  // ── Render ─────────────────────────────────

  return (
    <div className="container mx-auto max-w-4xl p-6 md:p-12 space-y-8">
      {/* Navigation */}
      <Link
        href={`/organizations/${orgId}/team`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Team
      </Link>

      {/* ─── Profile Header Card ─── */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-start gap-6">
            {/* Avatar */}
            <Avatar className="h-20 w-20 shrink-0">
              <AvatarFallback className="text-xl font-semibold bg-primary/10 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>

            {/* Info */}
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <h1 className="text-2xl font-bold tracking-tight truncate">{displayName}</h1>
                <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{user.email}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={roleConfig.variant}>{roleConfig.label}</Badge>
                <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
              </div>

              {/* Meta info row */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
                {user.phone && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" />
                    {user.phone}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Joined {formatDate(user.createdAt)}
                </span>
              </div>
            </div>

            {/* Edit button */}
            {canEdit && !isEditing && (
              <Button variant="outline" size="sm" onClick={handleStartEditing} className="shrink-0">
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── User Details Section (view / edit) ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                User Details
              </CardTitle>
              <CardDescription>
                {isEditing ? 'Edit user profile information and role' : 'User profile information and role'}
              </CardDescription>
            </div>
            {isEditing && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleCancelEditing} disabled={isSaving}>
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveUser} disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Save
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {isEditing ? (
            /* ─── Edit Mode ─── */
            <div className="grid gap-5">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Email</Label>
                <Input value={user.email} disabled className="bg-muted" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

              <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                  <SelectTrigger className="w-full sm:w-[200px]">
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
          ) : (
            /* ─── View Mode ─── */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
              <DetailField icon={<Mail className="h-4 w-4" />} label="Email" value={user.email} />
              <DetailField icon={<User className="h-4 w-4" />} label="First Name" value={user.firstName ?? '—'} />
              <DetailField icon={<User className="h-4 w-4" />} label="Last Name" value={user.lastName ?? '—'} />
              <DetailField icon={<Phone className="h-4 w-4" />} label="Phone" value={user.phone ?? '—'} />
              <DetailField
                icon={<Shield className="h-4 w-4" />}
                label="Role"
                value={
                  <Badge variant={roleConfig.variant} className="mt-0.5">
                    {roleConfig.label}
                  </Badge>
                }
              />
              <DetailField
                icon={<Calendar className="h-4 w-4" />}
                label="Joined"
                value={formatDate(user.createdAt)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Organization Access ─── */}
      <PermissionWrapper requiredPermission="user:edit">
        <OrganizationAccessSection userId={userId} orgId={orgId} email={user.email} />
      </PermissionWrapper>

      {/* ─── Knowledge Base Access ─── */}
      <PermissionWrapper requiredPermission="kb:edit">
        <KBAccessSection userId={userId} orgId={orgId} />
      </PermissionWrapper>

      {/* ─── Danger Zone ─── */}
      <PermissionWrapper requiredPermission="user:delete">
        <DangerZoneSection userId={userId} orgId={orgId} email={user.email} />
      </PermissionWrapper>
    </div>
  );
}

// ────────────────────────────────────────────
// Detail Field (read-only)
// ────────────────────────────────────────────

function DetailField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

// ────────────────────────────────────────────
// Organization Access Section
// ────────────────────────────────────────────

function OrganizationAccessSection({
  userId,
  orgId,
  email,
}: {
  userId: string;
  orgId: string;
  email: string;
}) {
  const { toast } = useToast();
  const { data: allOrgs = [] } = useOrganizations();
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [isMutating, setIsMutating] = useState(false);

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
      <CardContent>
        <div className="flex items-center gap-2">
          <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select organization to add…" />
            </SelectTrigger>
            <SelectContent>
              {allOrgs.length === 0 ? (
                <SelectItem value="_none" disabled>
                  No organizations available
                </SelectItem>
              ) : (
                allOrgs.map((org: { id: string; name: string }) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button onClick={handleAddToOrg} disabled={!selectedOrgId || isMutating}>
            {isMutating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Plus className="h-4 w-4 mr-1" /> Add
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────
// Knowledge Base Access Section
// ────────────────────────────────────────────

function KBAccessSection({ userId, orgId }: { userId: string; orgId: string }) {
  const { toast } = useToast();
  const { data: allKBs = [], isLoading: isLoadingKBs } = useKnowledgeBases(orgId);
  const { data: accessData, isLoading: isLoadingAccess } = useUserKBAccess(userId, orgId);
  const [mutatingKbId, setMutatingKbId] = useState<string | null>(null);

  const grantedKBIds = useMemo(() => {
    const ids = new Set<string>();
    for (const record of accessData?.records ?? []) ids.add(record.kbId);
    return ids;
  }, [accessData]);

  const handleGrantKB = useCallback(
    async (kbId: string) => {
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
    },
    [userId, orgId, toast],
  );

  const handleRevokeKB = useCallback(
    async (kbId: string) => {
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
    },
    [userId, orgId, toast],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Knowledge Base Access
        </CardTitle>
        <CardDescription>
          Control which knowledge bases this user can access ({grantedKBIds.size} of {allKBs.length}{' '}
          granted)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoadingKBs || isLoadingAccess ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border">
                <Skeleton className="h-4 w-4 rounded" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
            ))}
          </div>
        ) : allKBs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
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
                  className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
                    hasAccess ? 'border-primary/50 bg-primary/5' : 'border-dashed'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Database
                      className={`h-4 w-4 shrink-0 ${hasAccess ? 'text-primary' : 'text-muted-foreground'}`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{kb.name}</p>
                      {kb.description && (
                        <p className="text-xs text-muted-foreground truncate">{kb.description}</p>
                      )}
                    </div>
                    <Badge variant={hasAccess ? 'default' : 'outline'} className="text-xs shrink-0">
                      {kb.type === 'CONTENT_LIBRARY' ? 'Q&A' : 'Documents'}
                    </Badge>
                  </div>
                  {hasAccess ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevokeKB(kb.id)}
                      disabled={!!mutatingKbId}
                      className="text-destructive hover:text-destructive shrink-0"
                    >
                      {isMutating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleGrantKB(kb.id)}
                      disabled={!!mutatingKbId}
                      className="shrink-0"
                    >
                      {isMutating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Plus className="h-4 w-4 mr-1" /> Grant
                        </>
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────
// Danger Zone Section
// ────────────────────────────────────────────

function DangerZoneSection({
  userId,
  orgId,
  email,
}: {
  userId: string;
  orgId: string;
  email: string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const handleDelete = useCallback(async () => {
    try {
      await deleteUserApi({ orgId, userId });
      toast({
        title: 'User removed',
        description: `${email} has been removed from the organization.`,
      });
      router.push(`/organizations/${orgId}/team`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove user';
      toast({ title: 'Error', description: message, variant: 'destructive' });
      throw err;
    }
  }, [orgId, userId, email, toast, router]);

  return (
    <>
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>Irreversible actions</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Remove User</AlertTitle>
            <AlertDescription>
              Removing {email} will revoke all access to this organization, including projects,
              knowledge bases, and team features.
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

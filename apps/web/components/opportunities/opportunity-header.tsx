'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useParams } from 'next/navigation';
import DOMPurify from 'dompurify';
import {
  AlertCircle,
  CalendarClock,
  Check,
  FolderOpen,
  Loader2,
  Pencil,
  Tag,
  Target,
  Trash2,
  UserCircle2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useOpportunityContext } from './opportunity-context';
import { useCurrentOrganization } from '@/context/organization-context';
import { formatDateTime } from './opportunity-helpers';
import { useDeleteOpportunity, useUpdateOpportunity } from '@/lib/hooks/use-opportunities';

export function OpportunityHeader() {
  const { projectId, oppId, opportunity, isLoading, error, refetch } = useOpportunityContext();
  const { currentOrganization } = useCurrentOrganization();
  const orgId = currentOrganization?.id;
  const router = useRouter();
  const params = useParams();

  const { trigger: deleteOpportunity, isMutating: isDeleting } = useDeleteOpportunity();
  const { trigger: updateOpportunity, isMutating: isUpdating } = useUpdateOpportunity(orgId);

  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('');
  const [setAside, setSetAside] = useState('');
  const [naicsCode, setNaicsCode] = useState('');
  const [pscCode, setPscCode] = useState('');
  const [active, setActive] = useState(false);
  const [organizationName, setOrganizationName] = useState('');

  // Populate form when entering edit mode
  useEffect(() => {
    if (isEditing && opportunity) {
      setTitle(opportunity.title);
      setDescription(opportunity.description || '');
      setType(opportunity.type || '');
      setSetAside(opportunity.setAside || '');
      setNaicsCode(opportunity.naicsCode || '');
      setPscCode(opportunity.pscCode || '');
      setActive(opportunity.active);
      setOrganizationName(opportunity.organizationName || '');
      setUpdateError(null);
    }
  }, [isEditing, opportunity]);

  const briefUrl = orgId
    ? `/organizations/${orgId}/projects/${projectId}/brief?opportunityId=${oppId}`
    : '#';

  const backUrl = orgId
    ? `/organizations/${orgId}/projects/${projectId}/opportunities`
    : '#';

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdateError(null);

    if (!title.trim()) {
      setUpdateError('Title is required');
      return;
    }

    const resolvedProjectId = (params?.projectId as string) || opportunity?.projectId || projectId;

    try {
      await updateOpportunity({
        projectId: resolvedProjectId,
        oppId,
        patch: {
          title: title.trim(),
          description: description.trim() || null,
          type: type.trim() || null,
          setAside: setAside.trim() || null,
          naicsCode: naicsCode.trim() || null,
          pscCode: pscCode.trim() || null,
          active,
          organizationName: organizationName.trim() || null,
        },
      });
      setIsEditing(false);
      refetch();
    } catch (err: any) {
      setUpdateError(err?.message || 'Failed to update opportunity');
    }
  }, [title, description, type, setAside, naicsCode, pscCode, active, organizationName, oppId, projectId, params, opportunity, updateOpportunity, refetch]);

  const handleConfirmDelete = useCallback(async () => {
    if (!oppId || !projectId) return;
    try {
      await deleteOpportunity({ projectId, oppId, orgId: orgId || '' });
      setShowDeleteConfirm(false);
      router.push(backUrl);
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete opportunity');
    }
  }, [oppId, projectId, orgId, deleteOpportunity, router, backUrl]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {isEditing ? (
              /* ── Inline edit form ── */
              <form id="opp-edit-form" onSubmit={handleSave} className="space-y-4">
                {/* Title */}
                <div className="grid gap-1.5">
                  <Label htmlFor="opp-title">Title *</Label>
                  <Input
                    id="opp-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Opportunity title"
                    required
                    autoFocus
                  />
                </div>

                {/* Organization */}
                <div className="grid gap-1.5">
                  <Label htmlFor="opp-org">Organization</Label>
                  <Input
                    id="opp-org"
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    placeholder="Organization name"
                  />
                </div>

                {/* Type + Set-Aside */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="opp-type">Type</Label>
                    <Input
                      id="opp-type"
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                      placeholder="e.g., Solicitation"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="opp-setaside">Set-Aside</Label>
                    <Input
                      id="opp-setaside"
                      value={setAside}
                      onChange={(e) => setSetAside(e.target.value)}
                      placeholder="e.g., 8(a)"
                    />
                  </div>
                </div>

                {/* NAICS + PSC */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="opp-naics">NAICS Code</Label>
                    <Input
                      id="opp-naics"
                      value={naicsCode}
                      onChange={(e) => setNaicsCode(e.target.value)}
                      placeholder="e.g., 541512"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="opp-psc">PSC Code</Label>
                    <Input
                      id="opp-psc"
                      value={pscCode}
                      onChange={(e) => setPscCode(e.target.value)}
                      placeholder="e.g., D302"
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="grid gap-1.5">
                  <Label htmlFor="opp-desc">Description</Label>
                  <Textarea
                    id="opp-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Opportunity description"
                    rows={3}
                  />
                </div>

                {/* Active toggle */}
                <div className="flex items-center justify-between">
                  <Label htmlFor="opp-active" className="cursor-pointer">Active</Label>
                  <Switch id="opp-active" checked={active} onCheckedChange={setActive} />
                </div>

                {updateError && (
                  <Alert variant="destructive">
                    <AlertDescription>{updateError}</AlertDescription>
                  </Alert>
                )}
              </form>
            ) : (
              /* ── Read-only view ── */
              <>
                <CardTitle className="flex items-center gap-2 truncate">
                  <FolderOpen className="h-5 w-5" />
                  {isLoading ? 'Loading opportunity…' : opportunity?.title ?? 'Opportunity'}
                </CardTitle>
                <CardDescription className="truncate">
                  {opportunity?.organizationName ?? '—'}
                </CardDescription>

                {opportunity && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary">{opportunity.source}</Badge>
                    {opportunity.active ? <Badge>ACTIVE</Badge> : <Badge variant="outline">INACTIVE</Badge>}
                    {opportunity.type && <Badge variant="outline">{opportunity.type}</Badge>}
                    {opportunity.naicsCode && (
                      <Badge variant="outline" className="gap-1">
                        <Tag className="h-3.5 w-3.5" />
                        NAICS {opportunity.naicsCode}
                      </Badge>
                    )}
                    {opportunity.pscCode && <Badge variant="outline">PSC {opportunity.pscCode}</Badge>}
                    {opportunity.setAside && <Badge variant="outline">{opportunity.setAside}</Badge>}
                    {opportunity.solicitationNumber && (
                      <Badge variant="outline">Solicitation {opportunity.solicitationNumber}</Badge>
                    )}
                    {opportunity.noticeId && <Badge variant="outline">Notice {opportunity.noticeId}</Badge>}
                  </div>
                )}

                {opportunity && (
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3.5 w-3.5" />
                      Posted: {formatDateTime(opportunity.postedDateIso)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3.5 w-3.5" />
                      Due: {formatDateTime(opportunity.responseDeadlineIso)}
                    </span>
                  </div>
                )}

                {opportunity && (opportunity.createdByName ?? opportunity.updatedByName) ? (
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    {opportunity.createdByName ? (
                      <span className="inline-flex items-center gap-1">
                        <UserCircle2 className="h-3.5 w-3.5" />
                        Created by: <span className="text-foreground/90 ml-1">{opportunity.createdByName}</span>
                      </span>
                    ) : null}
                    {opportunity.updatedByName && opportunity.updatedByName !== opportunity.createdByName ? (
                      <span className="inline-flex items-center gap-1">
                        <UserCircle2 className="h-3.5 w-3.5" />
                        Updated by: <span className="text-foreground/90 ml-1">{opportunity.updatedByName}</span>
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* Action buttons */}
          <div className="shrink-0 flex items-center gap-2">
            {isEditing ? (
              <>
                <Button
                  type="submit"
                  form="opp-edit-form"
                  size="sm"
                  disabled={isUpdating}
                >
                  {isUpdating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(false)}
                  disabled={isUpdating}
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" asChild>
                  <Link href={briefUrl}>
                    <Target className="h-4 w-4 mr-2" />
                    Executive Brief
                  </Link>
                </Button>
                {opportunity && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditing(true)}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={isDeleting}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      {isDeleting ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 mr-2" />
                      )}
                      Delete
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </CardHeader>

        {/* Description (read-only mode only) */}
        {!isEditing && (
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            ) : opportunity?.description ? (
              <div
                className={cn(
                  'prose prose-sm max-w-none text-sm text-muted-foreground leading-relaxed',
                  '[&_p]:mb-2 [&_p:last-child]:mb-0',
                  '[&_div]:mb-1',
                  '[&_ul]:mb-2 [&_ul]:pl-5 [&_ul>li]:list-disc [&_ul>li]:mb-0.5',
                  '[&_ol]:mb-2 [&_ol]:pl-5 [&_ol>li]:list-decimal [&_ol>li]:mb-0.5',
                  '[&_strong]:font-semibold [&_strong]:text-foreground',
                  '[&_b]:font-semibold [&_b]:text-foreground',
                  '[&_em]:italic',
                  '[&_u]:underline',
                  '[&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground [&_h1]:mt-3 [&_h1]:mb-1',
                  '[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-2 [&_h2]:mb-1',
                  '[&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-foreground [&_h3]:mt-2 [&_h3]:mb-0.5',
                  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:opacity-80',
                  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_table]:mb-2',
                  '[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted [&_th]:font-medium [&_th]:text-left',
                  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
                  '[&_hr]:border-border [&_hr]:my-2',
                  '[&_span]:leading-relaxed',
                )}
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(opportunity.description, {
                    ALLOWED_TAGS: [
                      'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's',
                      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                      'ul', 'ol', 'li',
                      'a', 'blockquote', 'code', 'pre', 'hr',
                      'table', 'thead', 'tbody', 'tr', 'th', 'td',
                    ],
                    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style'],
                    FORCE_BODY: true,
                  }),
                }}
              />
            ) : (
              <span className="text-sm text-muted-foreground">No description available.</span>
            )}
          </CardContent>
        )}
      </Card>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Opportunity</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-semibold text-foreground">"{opportunity?.title}"</span>?
              This will also delete all associated question files and cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <Alert variant="destructive">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowDeleteConfirm(false); setDeleteError(null); }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={isDeleting}>
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

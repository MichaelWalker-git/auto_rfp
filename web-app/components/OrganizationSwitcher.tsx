'use client';

import * as React from 'react';
import { ChevronDown, Plus, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';

import { useCurrentOrganization } from '@/context/organization-context';
import { useCreateOrganization } from '@/lib/hooks/use-create-organization';
import { generateSlug } from '@/lib/utils';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import { useApi } from '@/lib/hooks/use-api';

/**
 * Load icon presigned URL using the same approach as SettingsContent:
 * 1. Fetch org detail to get iconKey
 * 2. Use presigned URL endpoint to get download URL
 */
function useOrgIcon(orgId: string | undefined | null): string | null {
  const [iconUrl, setIconUrl] = React.useState<string | null>(null);
  const lastOrgIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!orgId) {
      setIconUrl(null);
      lastOrgIdRef.current = null;
      return;
    }

    if (lastOrgIdRef.current === orgId && iconUrl) return;
    lastOrgIdRef.current = orgId;

    let cancelled = false;

    (async () => {
      try {
        // Step 1: Get org details to find iconKey
        const orgRes = await authFetcher(
          `${env.BASE_API_URL}/organization/get-organization/${encodeURIComponent(orgId)}`,
        );
        if (!orgRes.ok || cancelled) return;
        const orgData = await orgRes.json();
        const iconKey = orgData?.iconKey;
        if (!iconKey || cancelled) return;

        // Step 2: Get presigned download URL (same as settings page)
        const presignRes = await authFetcher(`${env.BASE_API_URL}/presigned/presigned-url`, {
          method: 'POST',
          body: JSON.stringify({ operation: 'download', key: iconKey }),
        });
        if (!presignRes.ok || cancelled) return;
        const presignData = await presignRes.json();
        if (presignData?.url && !cancelled) {
          setIconUrl(presignData.url);
        }
      } catch {
        // Silently fail - icon is optional
      }
    })();

    return () => { cancelled = true; };
  }, [orgId]);

  return iconUrl;
}

export function OrganizationSwitcher() {
  const { toast } = useToast();

  const {
    currentOrganization,
    organizations,
    setCurrentOrganization,
    isOrgLocked,
    loading,
    refreshData,
  } = useCurrentOrganization();

  const { createOrganization } = useCreateOrganization();

  const label = currentOrganization?.name ?? (loading ? 'Loading…' : 'Select organization');

  // Load current org icon using the same method as settings page
  const currentIconUrl = useOrgIcon(currentOrganization?.id);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);

  const [orgForm, setOrgForm] = React.useState({
    name: '',
    slug: '',
    description: '',
  });

  const canCreateOrg = !isOrgLocked;

  const handleCreate = async () => {
    const name = orgForm.name.trim();
    const slug = orgForm.slug.trim();

    if (!name) {
      toast({ title: 'Error', description: 'Organization name is required', variant: 'destructive' });
      return;
    }
    if (!slug) {
      toast({ title: 'Error', description: 'Slug is required', variant: 'destructive' });
      return;
    }

    try {
      setIsCreating(true);

      const res = await createOrganization({
        name,
        slug,
        description: orgForm.description?.trim() || '',
      });

      const newOrgId = res?.id;
      if (!newOrgId) {
        throw new Error('Create organization did not return an id');
      }

      await refreshData();

      const fresh = organizations.find((o) => o.id === newOrgId);
      setCurrentOrganization(
        (fresh ?? { id: newOrgId, name, slug, description: orgForm.description }) as any,
      );

      toast({ title: 'Success', description: 'Organization created' });

      setCreateOpen(false);
      setOrgForm({ name: '', slug: '', description: '' });
    } catch (e) {
      console.error(e);
      toast({
        title: 'Error',
        description: e instanceof Error ? e.message : 'Failed to create organization',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2" disabled={loading || !currentOrganization}>
            {currentOrganization ? (
              <Avatar className="h-5 w-5">
                {currentIconUrl ? (
                  <AvatarImage src={currentIconUrl} alt={currentOrganization.name ?? ''} />
                ) : null}
                <AvatarFallback className="text-[10px]">
                  {currentOrganization.name?.charAt(0)?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ) : null}
            <span className="max-w-[220px] truncate">{label}</span>
            <ChevronDown className="h-4 w-4 opacity-70" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-[280px]">
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Organization</span>
            {isOrgLocked && <span className="text-xs text-muted-foreground">Locked</span>}
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          {organizations.map((org) => {
            const active = org.id === currentOrganization?.id;

            return (
              <DropdownMenuItem
                key={org.id}
                disabled={isOrgLocked || active}
                onClick={() => setCurrentOrganization(org)}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <Avatar className="h-5 w-5">
                    <AvatarFallback className="text-[10px]">
                      {org.name?.charAt(0)?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{org.name}</span>
                </div>
                {active && <span className="text-xs text-muted-foreground">Current</span>}
              </DropdownMenuItem>
            );
          })}

          {canCreateOrg && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setCreateOpen(true);
                }}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Create organization
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create Organization Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization Name</Label>
              <Input
                id="org-name"
                value={orgForm.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setOrgForm((prev) => ({
                    ...prev,
                    name,
                    slug: prev.slug ? prev.slug : generateSlug(name),
                  }));
                }}
                placeholder="My Organization"
                disabled={isCreating}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-slug">Slug</Label>
              <Input
                id="org-slug"
                value={orgForm.slug}
                onChange={(e) => setOrgForm((prev) => ({ ...prev, slug: e.target.value }))}
                placeholder="my-organization"
                disabled={isCreating}
              />
              <p className="text-xs text-muted-foreground">
                Used in URLs. Lowercase letters, numbers, hyphens.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-description">Description</Label>
              <Textarea
                id="org-description"
                value={orgForm.description}
                onChange={(e) => setOrgForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Optional"
                disabled={isCreating}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={isCreating}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={isCreating}>
                {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isCreating ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
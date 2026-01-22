'use client';

import * as React from 'react';
import { ChevronDown, Plus, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
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

import { useOrganization } from '@/context/organization-context';
import { useCreateOrganization } from '@/lib/hooks/use-create-organization';
import { generateSlug } from '@/lib/utils';

export function OrganizationSwitcher() {
  const { toast } = useToast();

  const {
    currentOrganization,
    organizations,
    setCurrentOrganization,
    isOrgLocked,
    loading,
    refreshData,
  } = useOrganization();

  const { createOrganization } = useCreateOrganization();

  const label = currentOrganization?.name ?? (loading ? 'Loading…' : 'Select organization');

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

      // Prefer selecting real org object from refreshed list
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
                <span className="truncate">{org.name}</span>
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
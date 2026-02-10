'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { OpportunityItem } from '@auto-rfp/shared';
import { Loader2, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { useUpdateOpportunity } from '@/lib/hooks/use-opportunities';
import { useCurrentOrganization } from '@/context/organization-context';

interface EditOpportunityDialogProps {
  item: OpportunityItem;
  onUpdated?: (item: OpportunityItem) => void;
  trigger?: React.ReactNode;
}

export function EditOpportunityDialog({ item, onUpdated, trigger }: EditOpportunityDialogProps) {
  const { currentOrganization } = useCurrentOrganization();
  const params = useParams();
  const { trigger: updateOpportunity, isMutating: isUpdating } = useUpdateOpportunity(currentOrganization?.id);

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description || '');
  const [type, setType] = useState(item.type || '');
  const [setAside, setSetAside] = useState(item.setAside || '');
  const [naicsCode, setNaicsCode] = useState(item.naicsCode || '');
  const [pscCode, setPscCode] = useState(item.pscCode || '');
  const [active, setActive] = useState(item.active);
  const [organizationName, setOrganizationName] = useState(item.organizationName || '');

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTitle(item.title);
      setDescription(item.description || '');
      setType(item.type || '');
      setSetAside(item.setAside || '');
      setNaicsCode(item.naicsCode || '');
      setPscCode(item.pscCode || '');
      setActive(item.active);
      setOrganizationName(item.organizationName || '');
      setError(null);
    }
  }, [open, item]);

  const oppId = item.oppId ?? item.id;
  const projectId = (params?.projectId as string) || item.projectId;

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!oppId || !projectId) {
      setError('Missing projectId or oppId');
      return;
    }

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    try {
      const result = await updateOpportunity({
        projectId,
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

      setOpen(false);
      onUpdated?.(result.item);
    } catch (err: any) {
      setError(err?.message || 'Failed to update opportunity');
    }
  }, [oppId, projectId, title, description, type, setAside, naicsCode, pscCode, active, organizationName, updateOpportunity, onUpdated]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" variant="outline" className="gap-1.5">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Opportunity</DialogTitle>
            <DialogDescription>
              Update the opportunity details below.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Title */}
            <div className="grid gap-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Opportunity title"
                required
              />
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Opportunity description"
                rows={3}
              />
            </div>

            {/* Organization Name */}
            <div className="grid gap-2">
              <Label htmlFor="organizationName">Organization</Label>
              <Input
                id="organizationName"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="Organization name"
              />
            </div>

            {/* Type and Set-Aside */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="type">Type</Label>
                <Input
                  id="type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  placeholder="e.g., Solicitation"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="setAside">Set-Aside</Label>
                <Input
                  id="setAside"
                  value={setAside}
                  onChange={(e) => setSetAside(e.target.value)}
                  placeholder="e.g., 8(a)"
                />
              </div>
            </div>

            {/* NAICS and PSC Codes */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="naicsCode">NAICS Code</Label>
                <Input
                  id="naicsCode"
                  value={naicsCode}
                  onChange={(e) => setNaicsCode(e.target.value)}
                  placeholder="e.g., 541512"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pscCode">PSC Code</Label>
                <Input
                  id="pscCode"
                  value={pscCode}
                  onChange={(e) => setPscCode(e.target.value)}
                  placeholder="e.g., D302"
                />
              </div>
            </div>

            {/* Active Status */}
            <div className="flex items-center justify-between">
              <Label htmlFor="active" className="cursor-pointer">Active</Label>
              <Switch
                id="active"
                checked={active}
                onCheckedChange={setActive}
              />
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isUpdating}>
              Cancel
            </Button>
            <Button type="submit" disabled={isUpdating}>
              {isUpdating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
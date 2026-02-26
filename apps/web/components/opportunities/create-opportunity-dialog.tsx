'use client';

import React, { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import type { OpportunityItem } from '@auto-rfp/core';
import { Loader2, Plus } from 'lucide-react';

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
import { useCreateOpportunity } from '@/lib/hooks/use-opportunities';
import { useCurrentOrganization } from '@/context/organization-context';

interface CreateOpportunityDialogProps {
  projectId?: string;
  onCreated?: (item: OpportunityItem) => void;
  trigger?: React.ReactNode;
}

export function CreateOpportunityDialog({ projectId: propProjectId, onCreated, trigger }: CreateOpportunityDialogProps) {
  const { currentOrganization } = useCurrentOrganization();
  const params = useParams();
  const { trigger: createOpportunity, isMutating: isCreating } = useCreateOpportunity();

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('');
  const [setAside, setSetAside] = useState('');
  const [naicsCode, setNaicsCode] = useState('');
  const [pscCode, setPscCode] = useState('');
  const [active, setActive] = useState(true);
  const [organizationName, setOrganizationName] = useState('');
  const [solicitationNumber, setSolicitationNumber] = useState('');
  const [responseDeadline, setResponseDeadline] = useState('');

  const projectId = propProjectId || (params?.projectId as string);
  const orgId = currentOrganization?.id;

  // Reset form when dialog opens
  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (newOpen) {
      // Reset form on open
      setTitle('');
      setDescription('');
      setType('');
      setSetAside('');
      setNaicsCode('');
      setPscCode('');
      setActive(true);
      setOrganizationName('');
      setSolicitationNumber('');
      setResponseDeadline('');
      setError(null);
    }
    setOpen(newOpen);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!projectId) {
      setError('Missing projectId');
      return;
    }

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    // Generate a unique ID for manual entries
    const uniqueId = solicitationNumber.trim() || `manual-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      const opportunityData: OpportunityItem = {
        orgId: orgId || undefined,
        projectId,
        source: 'MANUAL_UPLOAD',
        id: uniqueId,
        title: title.trim(),
        type: type.trim() || null,
        postedDateIso: new Date().toISOString(),
        responseDeadlineIso: responseDeadline ? new Date(responseDeadline).toISOString() : null,
        noticeId: null,
        solicitationNumber: solicitationNumber.trim() || null,
        naicsCode: naicsCode.trim() || null,
        pscCode: pscCode.trim() || null,
        organizationName: organizationName.trim() || null,
        setAside: setAside.trim() || null,
        description: description.trim() || null,
        active,
        baseAndAllOptionsValue: null,
      };

      const result = await createOpportunity(opportunityData);

      setOpen(false);
      onCreated?.(result.item);
    } catch (err: any) {
      setError(err?.message || 'Failed to create opportunity');
    }
  }, [projectId, orgId, title, description, type, setAside, naicsCode, pscCode, active, organizationName, solicitationNumber, responseDeadline, createOpportunity, onCreated]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Create Opportunity
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Opportunity</DialogTitle>
            <DialogDescription>
              Manually create a new opportunity for this project.
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

            {/* Solicitation Number */}
            <div className="grid gap-2">
              <Label htmlFor="solicitationNumber">Solicitation Number</Label>
              <Input
                id="solicitationNumber"
                value={solicitationNumber}
                onChange={(e) => setSolicitationNumber(e.target.value)}
                placeholder="e.g., FA8532-24-R-0001"
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
                placeholder="Contracting organization name"
              />
            </div>

            {/* Response Deadline */}
            <div className="grid gap-2">
              <Label htmlFor="responseDeadline">Response Deadline</Label>
              <Input
                id="responseDeadline"
                type="datetime-local"
                value={responseDeadline}
                onChange={(e) => setResponseDeadline(e.target.value)}
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
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isCreating}>
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Opportunity'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
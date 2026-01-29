'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import type { Organization } from '@/app/organizations/page';

interface CreateEditOrganizationDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organization?: Organization;
  onSuccess?: (updatedOrganization: Organization) => void;
  isLoading?: boolean;
  formData?: {
    name: string;
    slug: string;
    description: string;
  };
  onFormChange?: (data: { name: string; slug: string; description: string }) => void;
  onSubmit?: () => void;
  editingOrg?: Organization | null;
}

export function CreateEditOrganizationDialog({
  isOpen,
  onOpenChange,
  organization,
  onSuccess,
  isLoading: externalIsLoading = false,
  formData: externalFormData,
  onFormChange: externalOnFormChange,
  onSubmit: externalOnSubmit,
  editingOrg,
}: CreateEditOrganizationDialogProps) {
  const [internalFormData, setInternalFormData] = useState({
    name: '',
    slug: '',
    description: '',
  });
  const [internalIsLoading, setInternalIsLoading] = useState(false);
  const { toast } = useToast();

  // Sync organization data to internal form when dialog opens in edit mode
  // Fixes AUTO-RFP-5V/5W: Cannot read properties of undefined (reading 'name')
  useEffect(() => {
    const orgToEdit = organization || editingOrg;
    if (isOpen && orgToEdit && !externalFormData) {
      setInternalFormData({
        name: orgToEdit.name ?? '',
        slug: orgToEdit.slug ?? '',
        description: orgToEdit.description ?? '',
      });
    }
  }, [isOpen, organization, editingOrg, externalFormData]);

  // Support both new and old prop patterns
  const isEditMode = !!organization || !!editingOrg;
  const currentOrg = organization || editingOrg;
  const formData = externalFormData || internalFormData;
  const isLoading = externalIsLoading || internalIsLoading;
  const title = isEditMode ? 'Edit Organization' : 'Create New Organization';

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setInternalFormData({
        name: '',
        slug: '',
        description: '',
      });
    }
    onOpenChange(open);
  };

  const handleFormChange = (data: { name: string; slug: string; description: string }) => {
    if (externalOnFormChange) {
      externalOnFormChange(data);
    } else {
      setInternalFormData(data);
    }
  };

  const handleSubmit = async () => {
    if (externalOnSubmit) {
      externalOnSubmit();
      return;
    }

    if (!currentOrg) return;

    try {
      setInternalIsLoading(true);
      const response = await fetch(`/organization/edit-organization/${currentOrg.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Organization updated successfully',
        });
        handleOpenChange(false);
        onSuccess?.(data);
      } else {
        toast({
          title: 'Error',
          description: data.error || 'Failed to update organization',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update organization',
        variant: 'destructive',
      });
    } finally {
      setInternalIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Organization Name</Label>
            <Input
              id="org-name"
              value={formData?.name ?? ''}
              onChange={(e) => {
                handleFormChange({
                  ...formData,
                  name: e.target.value,
                });
              }}
              placeholder="My Organization"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="org-description">Description</Label>
            <Textarea
              id="org-description"
              value={formData?.description ?? ''}
              onChange={(e) =>
                handleFormChange({
                  ...formData,
                  description: e.target.value,
                })
              }
              placeholder="Organization description..."
            />
          </div>

          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isEditMode ? 'Updating...' : 'Creating...'}
                </>
              ) : isEditMode ? (
                'Update Organization'
              ) : (
                'Create Organization'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

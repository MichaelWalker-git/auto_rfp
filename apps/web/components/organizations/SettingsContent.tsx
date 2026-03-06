'use client';

import React, { useEffect, useState } from 'react';
import { useOrganization } from '@/lib/hooks/use-api';
import { PageHeader } from '@/components/layout/page-header';
import {
  OrganizationGeneralSettings,
  OrganizationIntegrations,
  OrganizationConfigurationLinks,
  OrganizationDangerZone,
  useOrganizationIcon,
  useUpdateOrganization,
} from '@/features/organization-settings';
import { useToast } from '@/components/ui/use-toast';
import type { OrganizationItem } from '@auto-rfp/core';

interface SettingsContentProps {
  orgId: string;
}

export const SettingsContent: React.FC<SettingsContentProps> = ({ orgId }) => {
  const [organization, setOrganization] = useState<OrganizationItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [name, setName] = useState('');
  const { toast } = useToast();

  const { data: orgData, isLoading: isOrgLoading, isError: isOrgError, mutate } = useOrganization(orgId);

  const {
    iconUrl,
    iconS3Key,
    isUploadingIcon,
    handleIconUpload,
    handleRemoveIcon,
    loadIconPresignedUrl,
    setIconUrl,
    setIconS3Key,
  } = useOrganizationIcon(orgId);

  const { updateOrganization, isSaving } = useUpdateOrganization(orgId, mutate);

  useEffect(() => {
    if (orgData) {
      setOrganization(orgData);
      setName(orgData.name || '');
      // Load icon via presigned URL if org has an iconKey
      const orgIconKey = orgData.iconKey;
      if (orgIconKey) {
        setIconS3Key(orgIconKey);
        loadIconPresignedUrl(orgIconKey);
      } else {
        setIconUrl('');
        setIconS3Key('');
      }
      setIsLoading(false);
    } else {
      setIsLoading(isOrgLoading);
    }

    if (isOrgError) {
      toast({
        title: 'Error',
        description: 'Failed to load organization data',
        variant: 'destructive',
      });
    }
  }, [orgData, isOrgLoading, isOrgError, toast, loadIconPresignedUrl, setIconS3Key, setIconUrl]);

  // Force refresh of organization data when component mounts to ensure we have latest data
  useEffect(() => {
    mutate();
  }, [mutate]);

  const handleUpdateOrganization = async (event: React.FormEvent) => {
    event.preventDefault();

    const updatedOrg = await updateOrganization({
      name,
      iconKey: iconS3Key || undefined,
    });

    if (updatedOrg) {
      setOrganization(updatedOrg);
    }
  };

  const handleDeleteOrganization = () => {
    // This would typically open a confirmation dialog
    alert('This action would delete the organization. Not implemented in this demo.');
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-muted rounded"></div>
          <div className="h-32 bg-muted rounded"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-12">
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Organization Settings"
          description="Manage your organization configuration and integrations"
        />

        <OrganizationIntegrations orgId={orgId} />

        <OrganizationConfigurationLinks orgId={orgId} />

        <OrganizationGeneralSettings
          name={name}
          iconUrl={iconUrl}
          isUploadingIcon={isUploadingIcon}
          isSaving={isSaving}
          onNameChange={setName}
          onIconUpload={handleIconUpload}
          onIconRemove={handleRemoveIcon}
          onSubmit={handleUpdateOrganization}
        />

        <OrganizationDangerZone
          organizationName={organization?.name || ''}
          onDelete={handleDeleteOrganization}
        />
      </div>
    </div>
  );
};

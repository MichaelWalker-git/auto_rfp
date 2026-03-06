'use client';

import React from 'react';
import { SamGovApiKeyConfiguration } from '@/components/api-key/SamGovApiKeyConfiguration';
import { DibbsApiKeyConfiguration } from '@/components/api-key/DibbsApiKeyConfiguration';
import { GoogleApiKeyConfiguration } from '@/components/api-key/GoogleApiKeyConfiguration';
import { LinearApiKeyConfiguration } from '@/components/api-key/LinearApiKeyConfiguration';
import PermissionWrapper from '@/components/permission-wrapper';
import { ApnCredentialsForm } from '@/features/apn';

interface OrganizationIntegrationsProps {
  orgId: string;
}

export const OrganizationIntegrations: React.FC<OrganizationIntegrationsProps> = ({ orgId }) => {
  return (
    <>
      <SamGovApiKeyConfiguration orgId={orgId} />
      <DibbsApiKeyConfiguration orgId={orgId} />
      <GoogleApiKeyConfiguration orgId={orgId} />
      <LinearApiKeyConfiguration orgId={orgId} />

      {/* AWS Partner Network (APN) Credentials */}
      <PermissionWrapper requiredPermission="org:manage_settings">
        <ApnCredentialsForm orgId={orgId} />
      </PermissionWrapper>
    </>
  );
};

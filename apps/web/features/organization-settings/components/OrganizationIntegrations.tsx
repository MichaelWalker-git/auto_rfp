'use client';

import React from 'react';
import { SamGovApiKeyConfiguration } from '@/components/api-key/SamGovApiKeyConfiguration';
import { DibbsApiKeyConfiguration } from '@/components/api-key/DibbsApiKeyConfiguration';
import { GoogleApiKeyConfiguration } from '@/components/api-key/GoogleApiKeyConfiguration';
import { LinearApiKeyConfiguration } from '@/components/api-key/LinearApiKeyConfiguration';
import { HigherGovApiKeyConfiguration } from '@/components/api-key/HigherGovApiKeyConfiguration';

interface OrganizationIntegrationsProps {
  orgId: string;
}

export const OrganizationIntegrations: React.FC<OrganizationIntegrationsProps> = ({ orgId }) => {
  return (
    <>
      <SamGovApiKeyConfiguration orgId={orgId} />
      <DibbsApiKeyConfiguration orgId={orgId} />
      <HigherGovApiKeyConfiguration orgId={orgId} />
      <GoogleApiKeyConfiguration orgId={orgId} />
      <LinearApiKeyConfiguration orgId={orgId} />
    </>
  );
};

'use client';

import React from 'react';
import { OpportunitiesList } from '@/components/opportunities/OpportunitiesList';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import { CreateOpportunityDialog } from '@/components/opportunities/create-opportunity-dialog';
import PermissionWrapper from '@/components/permission-wrapper';

interface OpportunitiesPageContentProps {
  projectId: string;
  orgId: string;
}

export function OpportunitiesPageContent({ projectId, orgId }: OpportunitiesPageContentProps) {
  return (
    <div className="container mx-auto p-12">
      <ListingPageLayout
        title="Opportunities"
        description="Stored opportunities for this project."
        headerActions={
          <PermissionWrapper requiredPermission="opportunity:create">
            <CreateOpportunityDialog
              projectId={projectId}
            />
          </PermissionWrapper>
        }
      >
        <OpportunitiesList projectId={projectId} />
      </ListingPageLayout>
    </div>
  );
}

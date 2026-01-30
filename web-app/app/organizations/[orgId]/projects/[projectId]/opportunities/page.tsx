'use client';

import React from 'react';
import { OpportunitiesList } from '@/components/opportunities/OpportunitiesList';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import { useParams } from 'next/navigation';

export default function OpportunitiesPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId || '';

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <ListingPageLayout
        title="Opportunities"
        description="Stored opportunities for this project."
      >
        <OpportunitiesList projectId={projectId}/>
      </ListingPageLayout>
    </div>
  );
}

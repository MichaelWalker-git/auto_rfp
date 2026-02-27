'use client';

import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { SavedSearchList } from '@/components/organizations/SavedSearchList';
import type { SavedSearch } from '@auto-rfp/core';

interface Props {
  orgId: string;
}

export default function SavedSearchesPage({ orgId }: Props) {
  const router = useRouter();

  const handleOpen = (s: SavedSearch) => {
    // Encode criteria as URL param and navigate to search page
    const encoded = encodeURIComponent(JSON.stringify(s.criteria));
    router.push(`/organizations/${orgId}/search-opportunities?search=${encoded}`);
  };

  return (
    <div className="container mx-auto p-8">
      <PageHeader
        title="Saved Searches"
        description="Manage your scheduled searches across SAM.gov and DIBBS."
      />
      <div className="mt-6">
        <SavedSearchList
          orgId={orgId}
          onOpen={handleOpen}
        />
      </div>
    </div>
  );
}

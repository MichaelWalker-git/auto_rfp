'use client';

import { ContentLibraryProvider } from './ContentLibraryProvider';
import { ContentLibraryClient } from './ContentLibraryClient';
import type { ContentLibraryProps } from './types';

export function ContentLibraryContainer({ orgId, kbId }: ContentLibraryProps) {
  return (
    <ContentLibraryProvider orgId={orgId} kbId={kbId}>
      <div className="w-full max-w-7xl mx-auto">
        <div className="container mx-auto p-12">
          <ContentLibraryClient orgId={orgId} kbId={kbId} />
        </div>
      </div>
    </ContentLibraryProvider>
  );
}

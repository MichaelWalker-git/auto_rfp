'use client';

import { ContentLibraryProvider } from './ContentLibraryProvider';
import { ContentLibraryClient } from './ContentLibraryClient';
import type { ContentLibraryProps } from './types';

export function ContentLibraryContainer({ orgId, kbId }: ContentLibraryProps) {
  return (
    <ContentLibraryProvider orgId={orgId} kbId={kbId}>
      <ContentLibraryClient orgId={orgId} kbId={kbId} />
    </ContentLibraryProvider>
  );
}

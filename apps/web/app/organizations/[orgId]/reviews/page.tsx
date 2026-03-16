import React, { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { AssignedReviewsContent } from './assigned-reviews-content';

interface AssignedReviewsPageProps {
  params: Promise<{ orgId: string }>;
}

export default async function AssignedReviewsPage({ params }: AssignedReviewsPageProps) {
  const { orgId } = await params;

  return (
    <Suspense fallback={<PageLoadingSkeleton variant="list" hasHeader hasDescription rowCount={4} />}>
      <AssignedReviewsContent orgId={orgId} />
    </Suspense>
  );
}

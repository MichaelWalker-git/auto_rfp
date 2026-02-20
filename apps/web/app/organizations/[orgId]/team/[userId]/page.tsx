import React, { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { UserViewContent } from '@/components/organizations/UserViewContent';

interface UserViewPageProps {
  params: Promise<{ orgId: string; userId: string }>;
}

export default async function UserViewPage({ params }: UserViewPageProps) {
  const { orgId, userId } = await params;

  return (
    <Suspense fallback={<PageLoadingSkeleton hasDescription variant="detail" />}>
      <UserViewContent orgId={orgId} userId={userId} />
    </Suspense>
  );
}

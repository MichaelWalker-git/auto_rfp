import React, { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { UserEditContent } from '@/components/organizations/UserEditContent';

interface UserEditPageProps {
  params: Promise<{ orgId: string; userId: string }>;
}

export default async function UserEditPage({ params }: UserEditPageProps) {
  const { orgId, userId } = await params;

  return (
    <Suspense fallback={<PageLoadingSkeleton hasDescription variant="detail" />}>
      <UserEditContent orgId={orgId} userId={userId} />
    </Suspense>
  );
}

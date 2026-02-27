import { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { OrgDashboardClient } from './org-dashboard-client';

interface OrgDashboardPageProps {
  params: Promise<{ orgId: string }>;
}

export default async function OrgDashboardPage({ params }: OrgDashboardPageProps) {
  const { orgId } = await params;

  return (
    <Suspense fallback={<PageLoadingSkeleton hasDescription variant="grid" rowCount={6} gridCols={4} />}>
      <OrgDashboardClient orgId={orgId} />
    </Suspense>
  );
}

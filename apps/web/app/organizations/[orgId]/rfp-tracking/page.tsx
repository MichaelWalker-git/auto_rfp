import { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { RfpTrackingTabs } from '@/features/rfp-tracking';

interface RfpTrackingPageProps {
  params: Promise<{ orgId: string }>;
}

export default async function RfpTrackingPage({ params }: RfpTrackingPageProps) {
  const { orgId } = await params;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">RFP Tracking</h1>
        <p className="text-sm text-slate-500">
          Pipeline board, approval queue, and data-integrity flags across every project.
        </p>
      </div>

      <Suspense fallback={<PageLoadingSkeleton hasDescription variant="grid" rowCount={4} gridCols={4} />}>
        <RfpTrackingTabs orgId={orgId} />
      </Suspense>
    </div>
  );
}

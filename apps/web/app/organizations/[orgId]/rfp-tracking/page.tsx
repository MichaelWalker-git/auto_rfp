import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { RfpTrackingTabs, isRfpTrackingEnabledForOrg } from '@/features/rfp-tracking';

interface RfpTrackingPageProps {
  params: Promise<{ orgId: string }>;
}

export default async function RfpTrackingPage({ params }: RfpTrackingPageProps) {
  const { orgId } = await params;

  // RFP Tracking is a single-org (Horus Tech) feature, enabled per stage via
  // NEXT_PUBLIC_RFP_TRACKING_ORG_ID. Any other org gets a 404.
  if (!isRfpTrackingEnabledForOrg(orgId)) {
    notFound();
  }

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

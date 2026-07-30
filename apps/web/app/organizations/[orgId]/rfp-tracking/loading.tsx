import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

export default function RfpTrackingLoading() {
  return <PageLoadingSkeleton hasDescription variant="grid" rowCount={4} gridCols={4} />;
}

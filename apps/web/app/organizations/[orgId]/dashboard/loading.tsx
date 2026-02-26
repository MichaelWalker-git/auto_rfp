import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

export default function DashboardLoading() {
  return <PageLoadingSkeleton hasDescription variant="grid" rowCount={6} gridCols={4} />;
}

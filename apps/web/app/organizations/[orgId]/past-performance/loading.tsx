import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

export default function PastPerformanceLoading() {
  return <PageLoadingSkeleton hasDescription variant="list" rowCount={5} />;
}

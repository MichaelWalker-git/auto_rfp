import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

export default function AssignedReviewsLoading() {
  return <PageLoadingSkeleton variant="list" hasHeader hasDescription rowCount={4} />;
}

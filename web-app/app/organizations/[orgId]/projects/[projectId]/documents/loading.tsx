import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

export default function DocumentsLoading() {
  return <PageLoadingSkeleton hasDescription variant="list" rowCount={4} />;
}

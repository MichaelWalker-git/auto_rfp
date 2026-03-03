import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

export default function ContentLibraryLoading() {
  return <PageLoadingSkeleton hasDescription variant="list" rowCount={5} />;
}

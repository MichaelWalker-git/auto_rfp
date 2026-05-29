import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

export default function KBDetailLoading() {
  return <PageLoadingSkeleton hasDescription variant="list" rowCount={5} />;
}

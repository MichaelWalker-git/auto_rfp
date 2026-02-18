import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

export default function TemplatesLoading() {
  return <PageLoadingSkeleton hasDescription variant="grid" rowCount={6} />;
}

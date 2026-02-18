import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

export default function KnowledgeBaseLoading() {
  return <PageLoadingSkeleton hasDescription variant="grid" rowCount={3} />;
}

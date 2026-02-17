import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

export default function ProjectsLoading() {
  return <PageLoadingSkeleton hasDescription variant="grid" rowCount={3} />;
}

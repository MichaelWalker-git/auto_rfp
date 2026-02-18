import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

export default function OrganizationsLoading() {
  return <PageLoadingSkeleton hasDescription variant="grid" rowCount={3} />;
}

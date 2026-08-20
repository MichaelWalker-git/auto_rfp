import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

export default function EmployeesLoading() {
  return <PageLoadingSkeleton hasDescription variant="list" rowCount={6} />;
}

import { EmployeesPageContent } from '@/features/employees';

interface PageProps {
  params: Promise<{ orgId: string }>;
}

export default async function EmployeesPage({ params }: PageProps) {
  const { orgId } = await params;

  return <EmployeesPageContent orgId={orgId} />;
}

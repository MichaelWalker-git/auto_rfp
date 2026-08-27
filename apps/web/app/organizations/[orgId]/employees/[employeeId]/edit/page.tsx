import { EmployeeEditContent } from '@/features/employees';

interface PageProps {
  params: Promise<{ orgId: string; employeeId: string }>;
}

export default async function EmployeeEditPage({ params }: PageProps) {
  const { orgId, employeeId } = await params;

  return <EmployeeEditContent orgId={orgId} employeeId={employeeId} />;
}

import { EmployeeCreateContent } from '@/features/employees';

interface PageProps {
  params: Promise<{ orgId: string }>;
}

export default async function EmployeeCreatePage({ params }: PageProps) {
  const { orgId } = await params;

  return <EmployeeCreateContent orgId={orgId} />;
}

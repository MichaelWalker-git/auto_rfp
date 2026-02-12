import { TemplatesContainer } from '@/components/templates/TemplatesContainer';

interface TemplatesPageProps {
  params: Promise<{ orgId: string }>;
}

export default async function TemplatesPage({ params }: TemplatesPageProps) {
  const { orgId } = await params;
  return <TemplatesContainer orgId={orgId} />;
}
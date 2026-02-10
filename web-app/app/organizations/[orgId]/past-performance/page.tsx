import { PastProjectsContent } from '@/components/past-performance/PastProjectsContent';

interface PageProps {
  params: Promise<{ orgId: string }>;
}

export default async function PastPerformancePage({ params }: PageProps) {
  const { orgId } = await params;
  
  return <PastProjectsContent orgId={orgId} />;
}
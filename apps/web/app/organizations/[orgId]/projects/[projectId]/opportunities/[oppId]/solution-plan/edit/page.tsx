import { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { SolutionPlanEditorPage } from '@/features/solution-plan';

interface Props {
  params: Promise<{
    orgId: string;
    projectId: string;
    oppId: string;
  }>;
}

export default async function SolutionPlanEditPage({ params }: Props) {
  const { orgId, projectId, oppId } = await params;

  return (
    <Suspense fallback={<PageLoadingSkeleton variant="detail" hasDescription />}>
      <SolutionPlanEditorPage orgId={orgId} projectId={projectId} opportunityId={oppId} />
    </Suspense>
  );
}

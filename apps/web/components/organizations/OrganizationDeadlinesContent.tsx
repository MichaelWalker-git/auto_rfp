'use client';

import { useParams } from 'next/navigation';
import { useKnowledgeBases } from '@/lib/hooks/use-knowledgebase';
import { PageHeader } from '@/components/layout/page-header';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import DeadlinesDashboard from '../deadlines/DeadlinesDashboard';

interface OrgDeadlinesProps {
  params: Promise<{
    orgId: string;
  }>;
}

export default function OrganizationDeadlinesContent({ params }: OrgDeadlinesProps) {
  const { orgId } = useParams() as { orgId: string };
  const { isLoading } = useKnowledgeBases(orgId);

  if (isLoading) {
    return <PageLoadingSkeleton hasDescription variant="list" rowCount={5} />;
  }

  return (
    <div className="container mx-auto p-12">
      <PageHeader
        title="Deadlines"
        description="Track deadlines for all organization's RFPs"
      />
      <DeadlinesDashboard orgId={orgId} />
    </div>
  );
}

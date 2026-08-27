import { KBCoverageDashboard } from '@/features/kb-coverage';

interface KBCoveragePageProps {
  params: Promise<{ orgId: string }>;
}

export default async function KBCoveragePage({ params }: KBCoveragePageProps) {
  const { orgId } = await params;

  return (
    <div className="container mx-auto p-12">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Knowledge Base Coverage</h1>
        <p className="text-muted-foreground mt-1">
          Which document types the knowledge base can actually ground, and what is missing for the
          ones it cannot. Document generation checks this before it starts, so closing a gap here
          unblocks generation.
        </p>
      </div>
      <KBCoverageDashboard orgId={orgId} />
    </div>
  );
}

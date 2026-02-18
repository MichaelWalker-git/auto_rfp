import { StaleContentDashboard } from '@/components/content-library';

interface StaleReportPageProps {
  params: Promise<{ orgId: string; kbId: string }>;
}

export default async function StaleReportPage({ params }: StaleReportPageProps) {
  const { orgId, kbId } = await params;

  return (
    <div className="container mx-auto p-12">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Stale Content Report</h1>
        <p className="text-muted-foreground mt-1">
          Monitor outdated content across your Content Library and Knowledge Base documents.
          Stale content is flagged automatically by a daily scan.
        </p>
      </div>
      <StaleContentDashboard orgId={orgId} kbId={kbId} />
    </div>
  );
}

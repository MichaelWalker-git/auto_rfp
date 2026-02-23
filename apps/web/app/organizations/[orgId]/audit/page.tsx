import { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { AuditLogTable, AuditReportForm } from '@/features/audit';

interface AuditPageProps {
  params: Promise<{ orgId: string }>;
}

export const metadata = { title: 'Audit Trail' };

export default async function AuditPage({ params }: AuditPageProps) {
  const { orgId } = await params;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Trail</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Immutable record of all user actions, system events, and security events for compliance and accountability.
        </p>
      </div>

      <Suspense fallback={<PageLoadingSkeleton variant="list" />}>
        <AuditLogTable orgId={orgId} />
      </Suspense>

      <AuditReportForm orgId={orgId} />
    </div>
  );
}

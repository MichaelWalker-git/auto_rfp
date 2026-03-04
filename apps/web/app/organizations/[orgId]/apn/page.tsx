import { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { ApnRegistrationList, ApnCredentialsForm } from '@/features/apn';
import PermissionWrapper from '@/components/permission-wrapper';

interface ApnPageProps {
  params: Promise<{ orgId: string }>;
}

export const metadata = { title: 'AWS Partner Network' };

export default async function ApnPage({ params }: ApnPageProps) {
  const { orgId } = await params;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AWS Partner Network</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track proposal registrations with AWS Partner Central and manage your APN credentials.
        </p>
      </div>

      {/* Credentials card — ADMIN only */}
      <PermissionWrapper requiredPermission="org:manage_settings">
        <ApnCredentialsForm orgId={orgId} />
      </PermissionWrapper>

      {/* Registration list */}
      <Suspense fallback={<PageLoadingSkeleton variant="list" />}>
        <ApnRegistrationList orgId={orgId} />
      </Suspense>
    </div>
  );
}

import React, { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { KBAccessControl } from '@/components/kb/KBAccessControl';
import { PageSkeleton } from '@/components/projects/PageSkeleton';
import { Button } from '@/components/ui/button';

interface KBAccessPageProps {
  params: Promise<{ orgId: string; kbId: string }>;
}

export default async function KBAccessPage({ params }: KBAccessPageProps) {
  const { orgId, kbId } = await params;

  return (
    <div className="container mx-auto p-12">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/organizations/${orgId}/knowledge-base/${kbId}`} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            Back to Knowledge Base
          </Link>
        </Button>
      </div>
      <Suspense fallback={<PageSkeleton />}>
        <KBAccessControl kbId={kbId} orgId={orgId} />
      </Suspense>
    </div>
  );
}

import React, { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PromptsManager } from '@/components/organizations/PromptManager';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { Button } from '@/components/ui/button';

interface PromptsPageProps {
  params: Promise<{ orgId: string }>;
}

export default async function PromptsPage({ params }: PromptsPageProps) {
  const { orgId } = await params;

  return (
    <div className="container mx-auto p-12">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/organizations/${orgId}/settings`} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            Back to Settings
          </Link>
        </Button>
      </div>
      <Suspense fallback={<PageLoadingSkeleton hasDescription variant="list" rowCount={4} />}>
        <PromptsManager />
      </Suspense>
    </div>
  );
}

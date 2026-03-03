import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { SemanticSearchTester } from '@/components/kb/SemanticSearchTester';

interface SemanticSearchPageProps {
  params: Promise<{ orgId: string }>;
}

export default async function SemanticSearchSettingsPage({ params }: SemanticSearchPageProps) {
  const { orgId } = await params;

  return (
    <div className="container mx-auto p-12">
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
          <Link href={`/organizations/${orgId}/settings`} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            Back to Settings
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Semantic Search Tester</h1>
        <p className="text-muted-foreground mt-1">
          Test how semantic search retrieves content from your Org Documents, Q&amp;A Library, and Past Performance.
          Use this to verify that your indexed content is being found correctly.
        </p>
      </div>

      <Suspense fallback={<PageLoadingSkeleton variant="list" rowCount={3} />}>
        <SemanticSearchTester orgId={orgId} />
      </Suspense>
    </div>
  );
}

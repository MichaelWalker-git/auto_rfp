'use client';

import { PageHeader } from '@/components/layout/page-header';
import { SemanticSearchTester } from '@/components/kb/SemanticSearchTester';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface SemanticSearchPageProps {
  orgId: string;
  kbId: string;
}

export const SemanticSearchPage = ({ orgId, kbId }: SemanticSearchPageProps) => {
  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/organizations/${orgId}/knowledge-base/${kbId}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Knowledge Base
          </Link>
        </Button>
      </div>

      <PageHeader
        title="Semantic Search Tester"
        description="Test how semantic search retrieves content from your knowledge base, content library, and past performance. Use this to verify that your indexed content is being found correctly."
      />

      <div className="mt-6">
        <SemanticSearchTester orgId={orgId} />
      </div>
    </div>
  );
};

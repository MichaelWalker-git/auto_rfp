import { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { OpportunityDocumentEditorPage } from '@/components/rfp-documents/opportunity-document-editor-page';

interface Props {
  params: Promise<{
    orgId: string;
    projectId: string;
    oppId: string;
    documentId: string;
  }>;
}

export default async function OpportunityDocumentEditPage({ params }: Props) {
  const { orgId, projectId, oppId, documentId } = await params;

  return (
    <Suspense fallback={<PageLoadingSkeleton variant="detail" hasDescription />}>
      <OpportunityDocumentEditorPage
        orgId={orgId}
        projectId={projectId}
        opportunityId={oppId}
        documentId={documentId}
      />
    </Suspense>
  );
}

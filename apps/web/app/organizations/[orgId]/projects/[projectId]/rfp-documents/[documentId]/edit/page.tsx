import { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { RFPDocumentEditorPage } from '@/components/rfp-documents/rfp-document-editor-page';

interface Props {
  params: Promise<{
    orgId: string;
    projectId: string;
    documentId: string;
  }>;
  searchParams: Promise<{
    opportunityId?: string;
  }>;
}

export default async function RFPDocumentEditPage({ params, searchParams }: Props) {
  const { orgId, projectId, documentId } = await params;
  const { opportunityId } = await searchParams;

  return (
    <Suspense fallback={<PageLoadingSkeleton variant="detail" hasDescription />}>
      <RFPDocumentEditorPage
        orgId={orgId}
        projectId={projectId}
        documentId={documentId}
        opportunityId={opportunityId ?? 'default'}
      />
    </Suspense>
  );
}

'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi, apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import { PdfFormEditor } from '@/features/required-forms/components/PdfFormEditor';
import type { RFPDocumentItem } from '@auto-rfp/core';
import { useCurrentOrganization } from '@/context/organization-context';

export default function RequiredFormEditorPage() {
  const params = useParams<{ orgId: string; projectId: string; opportunityId: string; documentId: string }>();
  const { orgId, projectId, opportunityId, documentId } = params;
  const { currentOrganization } = useCurrentOrganization();
  const navOrgId = currentOrganization?.id ?? orgId;

  const { data: docData, isLoading: docLoading, mutate: mutateDoc } = useApi<{ document: RFPDocumentItem }>(
    documentId ? buildApiUrl('/rfp-document/get', { projectId, opportunityId, documentId, orgId: navOrgId }) : null,
    documentId ? buildApiUrl('/rfp-document/get', { projectId, opportunityId, documentId, orgId: navOrgId }) : null,
  );
  const doc = docData?.document ?? null;

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const fetchPdfUrl = useCallback(async (fileKey: string) => {
    try {
      const result = await apiMutate<{ url: string }>(
        buildApiUrl('/presigned/generate-presigned-url'),
        'POST',
        { operation: 'download', key: fileKey },
      );
      if (result?.url) setPdfUrl(result.url);
    } catch (err) {
      console.error('Failed to get PDF URL:', err);
    }
  }, []);

  useEffect(() => {
    if (doc?.fileKey) fetchPdfUrl(doc.fileKey);
  }, [doc?.fileKey, fetchPdfUrl]);

  if (docLoading || !doc) {
    return (
      <div className="flex flex-col h-screen">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-5 w-64" />
        </div>
        <div className="flex flex-1">
          <Skeleton className="flex-1" />
          <div className="w-[380px] border-l p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <PdfFormEditor
      doc={doc}
      orgId={navOrgId}
      pdfUrl={pdfUrl}
      onFieldUpdated={() => mutateDoc()}
    />
  );
}

'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { useApi, apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import { PdfFormEditor } from '@/features/required-forms/components/PdfFormEditor';
import { XlsxFormEditor } from '@/features/required-forms/components/XlsxFormEditor';
import type { RequiredFormItem } from '@auto-rfp/core';
import { useCurrentOrganization } from '@/context/organization-context';

export default function RequiredFormEditorPage() {
  const params = useParams<{ orgId: string; projectId: string; oppId: string; documentId: string }>();
  const { orgId, projectId, oppId: opportunityId, documentId: formId } = params;
  const { currentOrganization } = useCurrentOrganization();
  const navOrgId = currentOrganization?.id ?? orgId;

  const apiUrl = formId ? buildApiUrl('/required-forms/get', { projectId, opportunityId, formId, orgId: navOrgId }) : null;
  const [isPolling, setIsPolling] = useState(false);
  const { data: formData, isLoading, mutate: mutateForm } = useApi<{ form: RequiredFormItem }>(
    apiUrl,
    apiUrl,
    { refreshInterval: isPolling ? 3000 : 0 },
  );
  const form = formData?.form ?? null;

  useEffect(() => {
    setIsPolling(form?.status === 'IN_PROGRESS');
  }, [form?.status]);

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
    if (form?.sourceFileKey) fetchPdfUrl(form.sourceFileKey);
  }, [form?.sourceFileKey, fetchPdfUrl]);

  if (isLoading || !form) {
    return (
      <div className="flex flex-col h-screen">
        <div className="flex items-center gap-3 px-4 py-3 border-b bg-background">
          <Button variant="ghost" size="sm" asChild className="gap-1.5">
            <Link href={`/organizations/${navOrgId}/projects/${projectId}/opportunities/${opportunityId}`}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>
          <Skeleton className="h-5 w-64" />
        </div>
        <div className="flex flex-1">
          <Skeleton className="flex-1" />
          <div className="w-[320px] border-l p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const isXlsx = form.sourceFileKey?.endsWith('.xlsx') || form.sourceFileKey?.endsWith('.xls') ||
    form.formType === 'XLSX_MATRIX' || form.formType === 'XLSX_FORM';

  if (isXlsx) {
    return <XlsxFormEditor doc={form as any} orgId={navOrgId} onFieldUpdated={() => mutateForm()} />;
  }

  return (
    <PdfFormEditor
      doc={form as any}
      orgId={navOrgId}
      pdfUrl={pdfUrl}
      onFieldUpdated={() => mutateForm()}
    />
  );
}

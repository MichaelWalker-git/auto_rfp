'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, History, Loader2, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { QuestionnaireEditor } from '@/features/required-forms/components/QuestionnaireViewer';
import { QuestionnaireVersionHistory } from '@/features/package-edit';
import { useDocumentDownloadUrl } from '@/lib/hooks/use-rfp-documents';
import { usePresignUpload } from '@/lib/hooks/use-presign';
import type { RFPDocumentItem } from '@auto-rfp/core';

interface XlsxQuestionnaireEditorPageProps {
  doc: RFPDocumentItem;
  orgId: string;
  projectId: string;
  opportunityId: string;
  backUrl: string;
}

export const XlsxQuestionnaireEditorPage = ({
  doc,
  orgId,
  projectId,
  opportunityId,
  backUrl,
}: XlsxQuestionnaireEditorPageProps) => {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Remount key: bumped after a revert so QuestionnaireEditor re-reads the (now
  // replaced) .xlsx from S3 instead of showing the stale in-memory workbook.
  const [reloadKey, setReloadKey] = useState(0);
  const getBufferRef = useRef<(() => Promise<ArrayBuffer | null>) | null>(null);
  const { trigger: getDownloadUrl } = useDocumentDownloadUrl(orgId);
  const { trigger: presignUpload } = usePresignUpload();

  const handleWorkbookReady = useCallback((getBuffer: () => Promise<ArrayBuffer | null>) => {
    getBufferRef.current = getBuffer;
  }, []);

  const handleSave = useCallback(async () => {
    if (!getBufferRef.current) return;
    const buffer = await getBufferRef.current();
    if (!buffer) {
      toast({ title: 'Nothing to save', variant: 'default' });
      return;
    }

    try {
      setIsSaving(true);
      const fileKey = doc.fileKey;
      if (!fileKey) throw new Error('Document has no file key');

      const { url, method } = await presignUpload({
        key: fileKey,
        fileName: doc.originalFileName ?? doc.name ?? 'questionnaire.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const uploadRes = await fetch(url, {
        method: method || 'PUT',
        body: buffer,
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      });

      if (!uploadRes.ok && uploadRes.status !== 200 && uploadRes.status !== 204) {
        throw new Error('Upload failed');
      }

      setIsDirty(false);
      toast({ title: 'Saved', description: 'Questionnaire saved successfully.' });
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Could not save',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }, [doc.fileKey, doc.originalFileName, doc.name, presignUpload, toast]);

  const handleDownload = useCallback(async () => {
    if (isDownloading) return;
    try {
      setIsDownloading(true);
      const result = await getDownloadUrl({
        projectId,
        opportunityId,
        documentId: doc.documentId,
      });
      const a = document.createElement('a');
      a.href = result.url;
      a.download = doc.name ?? 'questionnaire.xlsx';
      a.click();
    } catch (err) {
      toast({
        title: 'Download failed',
        description: err instanceof Error ? err.message : 'Could not download',
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, getDownloadUrl, projectId, opportunityId, doc, toast]);

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-background shrink-0">
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground px-2 shrink-0" asChild>
          <Link href={backUrl}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>

        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-medium truncate">{doc.name}</h1>
        </div>

        <Badge variant="outline" className="text-xs bg-teal-50 text-teal-700 border-teal-200">
          Questionnaire
        </Badge>

        <Button
          size="sm"
          variant={showHistory ? 'secondary' : 'outline'}
          onClick={() => setShowHistory((v) => !v)}
          aria-pressed={showHistory}
        >
          <History className="h-4 w-4 mr-1" />
          History
        </Button>

        <Button size="sm" variant="outline" onClick={handleDownload} disabled={isDownloading}>
          {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
          Download
        </Button>

        <Button size="sm" onClick={handleSave} disabled={isSaving || !isDirty}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          Save
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <QuestionnaireEditor
            key={reloadKey}
            fileKey={doc.fileKey!}
            fileName={doc.name}
            onDirtyChange={setIsDirty}
            onWorkbookReady={handleWorkbookReady}
          />
        </div>

        {showHistory && (
          <aside className="w-80 shrink-0 overflow-y-auto border-l bg-gray-50 p-3">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Version history</h2>
            <QuestionnaireVersionHistory
              orgId={orgId}
              projectId={projectId}
              oppId={opportunityId}
              documentId={doc.documentId}
              onReverted={() => {
                setIsDirty(false);
                setReloadKey((k) => k + 1);
                toast({ title: 'Restored', description: 'Questionnaire reverted to the selected version.' });
              }}
            />
          </aside>
        )}
      </div>
    </div>
  );
};

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { Download, RefreshCw, ArrowLeft, Check } from 'lucide-react';
import { apiMutate, apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { DetectedFormField, RFPDocumentItem } from '@auto-rfp/core';
import { DocumentStatusBadge } from '@/components/rfp-documents/document-status-badge';

interface PdfFormEditorProps {
  doc: RFPDocumentItem;
  orgId: string;
  pdfUrl: string | null;
  onFieldUpdated?: () => void;
}

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  AUTO_FILLED: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700' },
  LOW_CONFIDENCE: { bg: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-700' },
  MANUAL_REQUIRED: { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-700' },
  EMPTY: { bg: 'bg-white', border: 'border-gray-200', text: 'text-gray-600' },
};

export const PdfFormEditor = ({ doc, orgId, pdfUrl, onFieldUpdated }: PdfFormEditorProps) => {
  const { toast } = useToast();
  const fields = (doc.formFields ?? []) as DetectedFormField[];
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [savingField, setSavingField] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [pdfPages, setPdfPages] = useState<string[]>([]);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({ width: 612, height: 792 });
  const containerRef = useRef<HTMLDivElement>(null);

  const backUrl = `/organizations/${orgId}/projects/${doc.projectId}/opportunities/${doc.opportunityId}`;

  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const f of fields) {
      if (f.value) initial[f.fieldId] = f.value;
    }
    setFieldValues(initial);
  }, [fields]);

  // Render PDF pages as images using pdf.js
  useEffect(() => {
    if (!pdfUrl) return;

    const loadPdf = async () => {
      setPdfLoading(true);
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

        const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
        const pages: string[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });

          if (i === 1) {
            setPageSize({ width: viewport.width, height: viewport.height });
          }

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d')!;
          await page.render({ canvasContext: ctx, viewport }).promise;
          pages.push(canvas.toDataURL('image/png'));
        }

        setPdfPages(pages);
      } catch (err) {
        console.error('Failed to render PDF:', err);
      } finally {
        setPdfLoading(false);
      }
    };

    loadPdf();
  }, [pdfUrl]);

  const handleSaveField = useCallback(async (fieldId: string, value: string) => {
    setSavingField(fieldId);
    try {
      await apiMutate(buildApiUrl('/rfp-document/form-field', { orgId }), 'PUT', {
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentId: doc.documentId,
        fieldId,
        value: value || null,
        orgId,
      });
      onFieldUpdated?.();
    } catch (err) {
      toast({ title: 'Failed to save field', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setSavingField(null);
      setEditingField(null);
    }
  }, [doc, orgId, onFieldUpdated, toast]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await apiFetcher<{ downloadUrl: string; fileName: string }>(
        buildApiUrl(`/rfp-document/export-form/${doc.documentId}`, { orgId, projectId: doc.projectId, opportunityId: doc.opportunityId }),
      );
      if (result?.downloadUrl) {
        window.open(result.downloadUrl, '_blank');
      }
    } catch (err) {
      toast({ title: 'Export failed', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }, [doc, orgId, toast]);

  const autoFilled = fields.filter((f) => f.status === 'AUTO_FILLED').length;
  const manual = fields.filter((f) => f.status === 'MANUAL_REQUIRED').length;

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-background shrink-0">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href={backUrl}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{doc.name}</p>
          <p className="text-xs text-muted-foreground">{doc.originalFileName ?? doc.name}</p>
        </div>
        <DocumentStatusBadge status={doc.status} />
        <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting || fields.length === 0} className="gap-1.5">
          {exporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export Filled PDF
        </Button>
      </div>

      {/* Main content: PDF with overlays + field panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: PDF pages with field overlays */}
        <div ref={containerRef} className="flex-1 overflow-y-auto bg-gray-200 p-4">
          {pdfLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3">
                <RefreshCw className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Rendering PDF...</p>
              </div>
            </div>
          ) : pdfPages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">Could not render PDF. Try refreshing.</p>
            </div>
          ) : (
            <div className="space-y-4 flex flex-col items-center">
              {pdfPages.map((dataUrl, pageIdx) => (
                <div
                  key={pageIdx}
                  className="relative bg-white shadow-lg"
                  style={{ width: pageSize.width, height: pageSize.height }}
                >
                  {/* Rendered PDF page as background */}
                  <img src={dataUrl} alt={`Page ${pageIdx + 1}`} className="w-full h-full" />

                  {/* Field overlays positioned on the page */}
                  {fields
                    .filter((f) => (f.pageNumber ?? 1) === pageIdx + 1 && f.boundingBox)
                    .map((field) => {
                      const bbox = field.boundingBox!;
                      const value = fieldValues[field.fieldId] ?? field.value ?? '';
                      const isActive = editingField === field.fieldId;

                      return (
                        <input
                          key={field.fieldId}
                          type="text"
                          value={value}
                          onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.fieldId]: e.target.value }))}
                          onFocus={() => setEditingField(field.fieldId)}
                          onBlur={() => handleSaveField(field.fieldId, fieldValues[field.fieldId] ?? '')}
                          placeholder={field.label}
                          className={cn(
                            'absolute bg-transparent text-[11px] px-0.5 outline-none transition-colors',
                            isActive && 'bg-blue-50/80 ring-1 ring-blue-400',
                            !isActive && value && 'bg-green-50/60',
                            !isActive && !value && 'bg-yellow-50/40 placeholder:text-gray-400 placeholder:text-[10px]',
                          )}
                          style={{
                            left: `${bbox.left * 100}%`,
                            top: `${bbox.top * 100}%`,
                            width: `${bbox.width * 100}%`,
                            height: `${bbox.height * 100}%`,
                          }}
                          title={field.label}
                        />
                      );
                    })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Field panel */}
        <div className="w-[340px] border-l flex flex-col overflow-hidden bg-background">
          {/* Stats */}
          <div className="px-4 py-3 border-b shrink-0">
            <p className="text-sm font-medium">{fields.length} Fields</p>
            <div className="flex gap-2 mt-1.5">
              {autoFilled > 0 && <Badge variant="outline" className="text-[10px] border-green-300 text-green-700 bg-green-50">{autoFilled} filled</Badge>}
              {manual > 0 && <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-700 bg-orange-50">{manual} manual</Badge>}
            </div>
          </div>

          {/* Field list */}
          <div className="flex-1 overflow-y-auto">
            {fields.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm text-muted-foreground">No fields detected.</p>
              </div>
            ) : (
              <div className="divide-y">
                {fields.map((field) => {
                  const colors = STATUS_COLORS[field.status] ?? STATUS_COLORS.EMPTY;
                  const isEditing = editingField === field.fieldId;
                  const currentValue = fieldValues[field.fieldId] ?? field.value ?? '';

                  return (
                    <div
                      key={field.fieldId}
                      className={cn('px-3 py-2', isEditing && 'bg-blue-50/50', colors.bg)}
                      onClick={() => setEditingField(field.fieldId)}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-medium text-muted-foreground truncate">{field.label}</p>
                        {savingField === field.fieldId && <RefreshCw className="h-3 w-3 animate-spin" />}
                      </div>
                      <p className={cn('text-sm truncate', !currentValue && 'italic text-muted-foreground')}>
                        {currentValue || (field.manualReason ?? '—')}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

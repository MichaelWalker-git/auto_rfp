'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { Download, RefreshCw } from 'lucide-react';
import { apiMutate, apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import { cn } from '@/lib/utils';
import useSWR from 'swr';
import type { DetectedFormField, RFPDocumentItem } from '@auto-rfp/core';

interface PdfFormEditorProps {
  doc: RFPDocumentItem;
  orgId: string;
  onFieldUpdated?: () => void;
}

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  AUTO_FILLED: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-800' },
  LOW_CONFIDENCE: { bg: 'bg-yellow-50', border: 'border-yellow-300', text: 'text-yellow-800' },
  MANUAL_REQUIRED: { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-800' },
  EMPTY: { bg: 'bg-white', border: 'border-gray-300', text: 'text-gray-700' },
};

export const PdfFormEditor = ({ doc, orgId, onFieldUpdated }: PdfFormEditorProps) => {
  const { toast } = useToast();
  const fields = (doc.formFields ?? []) as DetectedFormField[];

  // Fetch presigned URL for the PDF file
  const { data: presignData } = useSWR<{ url: string }>(
    doc.fileKey ? buildApiUrl('/presigned/generate-presigned-url', { operation: 'download', key: doc.fileKey }) : null,
    doc.fileKey ? (url: string) => apiFetcher<{ url: string }>(url) : null,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const pdfUrl = presignData?.url;
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [savingField, setSavingField] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const f of fields) {
      if (f.value) initial[f.fieldId] = f.value;
    }
    setFieldValues(initial);
  }, [fields]);

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

  if (fields.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">No form fields detected. The document may need manual processing.</p>
        </div>
        {pdfUrl ? <iframe src={pdfUrl} className="w-full h-[800px] border rounded-lg" title="PDF Preview" /> : <Skeleton className="w-full h-[800px]" />}
      </div>
    );
  }

  const autoFilled = fields.filter((f) => f.status === 'AUTO_FILLED').length;
  const manual = fields.filter((f) => f.status === 'MANUAL_REQUIRED').length;
  const empty = fields.filter((f) => f.status === 'EMPTY').length;

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{fields.length} fields</span>
          {autoFilled > 0 && <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50">{autoFilled} auto-filled</Badge>}
          {manual > 0 && <Badge variant="outline" className="border-orange-300 text-orange-700 bg-orange-50">{manual} manual</Badge>}
          {empty > 0 && <Badge variant="outline" className="border-gray-300 text-gray-600 bg-gray-50">{empty} empty</Badge>}
        </div>
        <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting} className="gap-1.5">
          {exporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export Filled PDF
        </Button>
      </div>

      {/* PDF viewer with overlay fields */}
      <div ref={containerRef} className="relative border rounded-lg overflow-hidden bg-gray-100">
        {pdfUrl ? <iframe src={pdfUrl} className="w-full h-[800px]" title="PDF Form" /> : <Skeleton className="w-full h-[800px]" />}
      </div>

      {/* Field list (editable) */}
      <div className="border rounded-lg divide-y">
        <div className="px-4 py-2 bg-muted/50">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Form Fields</p>
        </div>
        {fields.map((field) => {
          const colors = STATUS_COLORS[field.status] ?? STATUS_COLORS.EMPTY;
          const isEditing = editingField === field.fieldId;
          const currentValue = fieldValues[field.fieldId] ?? field.value ?? '';

          return (
            <div key={field.fieldId} className={cn('flex items-center gap-3 px-4 py-2.5', colors.bg)}>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground truncate">{field.label}</p>
                {isEditing ? (
                  <input
                    type="text"
                    className="w-full mt-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={currentValue}
                    onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.fieldId]: e.target.value }))}
                    onBlur={() => handleSaveField(field.fieldId, fieldValues[field.fieldId] ?? '')}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveField(field.fieldId, fieldValues[field.fieldId] ?? ''); if (e.key === 'Escape') setEditingField(null); }}
                    autoFocus
                  />
                ) : (
                  <p
                    className={cn('text-sm cursor-pointer hover:bg-white/50 rounded px-1 -mx-1', colors.text, !currentValue && 'italic text-muted-foreground')}
                    onClick={() => setEditingField(field.fieldId)}
                  >
                    {currentValue || (field.manualReason ?? 'Click to fill')}
                  </p>
                )}
              </div>
              <Badge variant="outline" className={cn('text-[10px] shrink-0', colors.border, colors.text)}>
                {field.status === 'AUTO_FILLED' ? 'Auto' : field.status === 'MANUAL_REQUIRED' ? 'Manual' : field.status === 'LOW_CONFIDENCE' ? 'Review' : 'Empty'}
              </Badge>
              {savingField === field.fieldId && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
          );
        })}
      </div>
    </div>
  );
};

'use client';

import { useState, useCallback, useEffect } from 'react';
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

  const backUrl = `/organizations/${orgId}/projects/${doc.projectId}/opportunities/${doc.opportunityId}`;

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

      {/* Main content: PDF viewer + field panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: PDF viewer */}
        <div className="flex-1 bg-gray-100 overflow-hidden">
          {pdfUrl ? (
            <iframe src={pdfUrl} className="w-full h-full border-0" title="PDF Document" />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Skeleton className="w-[600px] h-[800px]" />
            </div>
          )}
        </div>

        {/* Right: Field panel */}
        <div className="w-[380px] border-l flex flex-col overflow-hidden bg-background">
          {/* Field stats */}
          <div className="px-4 py-3 border-b shrink-0">
            <p className="text-sm font-medium">{fields.length} Fields Detected</p>
            <div className="flex gap-2 mt-1.5">
              {autoFilled > 0 && <Badge variant="outline" className="text-[10px] border-green-300 text-green-700 bg-green-50">{autoFilled} auto-filled</Badge>}
              {manual > 0 && <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-700 bg-orange-50">{manual} manual</Badge>}
              {fields.length - autoFilled - manual > 0 && <Badge variant="outline" className="text-[10px]">{fields.length - autoFilled - manual} empty</Badge>}
            </div>
          </div>

          {/* Field list */}
          <div className="flex-1 overflow-y-auto">
            {fields.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <p className="text-sm text-muted-foreground">No form fields were detected.</p>
                <p className="text-xs text-muted-foreground mt-1">The document may need manual processing.</p>
              </div>
            ) : (
              <div className="divide-y">
                {fields.map((field) => {
                  const colors = STATUS_COLORS[field.status] ?? STATUS_COLORS.EMPTY;
                  const isEditing = editingField === field.fieldId;
                  const currentValue = fieldValues[field.fieldId] ?? field.value ?? '';
                  const isSaving = savingField === field.fieldId;

                  return (
                    <div key={field.fieldId} className={cn('px-4 py-2.5', colors.bg)}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium text-muted-foreground truncate">{field.label}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          {isSaving && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
                          <span className={cn('text-[9px] font-medium uppercase', colors.text)}>
                            {field.status === 'AUTO_FILLED' ? 'auto' : field.status === 'MANUAL_REQUIRED' ? 'manual' : field.status === 'LOW_CONFIDENCE' ? 'review' : ''}
                          </span>
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="flex items-center gap-1 mt-1">
                          <input
                            type="text"
                            className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            value={currentValue}
                            onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.fieldId]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveField(field.fieldId, fieldValues[field.fieldId] ?? '');
                              if (e.key === 'Escape') setEditingField(null);
                            }}
                            autoFocus
                          />
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleSaveField(field.fieldId, fieldValues[field.fieldId] ?? '')}>
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <p
                          className={cn('text-sm mt-0.5 cursor-pointer hover:bg-white/70 rounded px-1 -mx-1 py-0.5', !currentValue && 'italic text-muted-foreground')}
                          onClick={() => setEditingField(field.fieldId)}
                        >
                          {currentValue || (field.manualReason ?? 'Click to fill')}
                        </p>
                      )}
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

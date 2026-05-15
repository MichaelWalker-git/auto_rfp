'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { Download, RefreshCw, ArrowLeft, Plus, Trash2, Move } from 'lucide-react';
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

export const PdfFormEditor = ({ doc, orgId, pdfUrl, onFieldUpdated }: PdfFormEditorProps) => {
  const { toast } = useToast();
  const fields = (doc.formFields ?? []) as DetectedFormField[];
  const [activeField, setActiveField] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [fieldPositions, setFieldPositions] = useState<Record<string, { top: number; left: number; width: number; height: number }>>({});
  const [savingField, setSavingField] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [pdfPages, setPdfPages] = useState<string[]>([]);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({ width: 612, height: 792 });
  const [dragging, setDragging] = useState<{ fieldId: string; startX: number; startY: number; origLeft: number; origTop: number } | null>(null);
  const [creatingField, setCreatingField] = useState(false);

  const backUrl = `/organizations/${orgId}/projects/${doc.projectId}/opportunities/${doc.opportunityId}`;

  useEffect(() => {
    const vals: Record<string, string> = {};
    const positions: Record<string, { top: number; left: number; width: number; height: number }> = {};
    for (const f of fields) {
      if (f.value) vals[f.fieldId] = f.value;
      if (f.boundingBox) positions[f.fieldId] = f.boundingBox;
    }
    setFieldValues(vals);
    setFieldPositions(positions);
  }, [fields]);

  // Render PDF pages
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
          if (i === 1) setPageSize({ width: viewport.width, height: viewport.height });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
          pages.push(canvas.toDataURL('image/png'));
        }
        setPdfPages(pages);
      } catch (err) {
        console.error('PDF render failed:', err);
      } finally {
        setPdfLoading(false);
      }
    };
    loadPdf();
  }, [pdfUrl]);

  const saveField = useCallback(async (fieldId: string, value: string) => {
    setSavingField(fieldId);
    try {
      await apiMutate(buildApiUrl('/rfp-document/form-field', { orgId }), 'PUT', {
        projectId: doc.projectId, opportunityId: doc.opportunityId,
        documentId: doc.documentId, fieldId, value: value || null, orgId,
      });
      onFieldUpdated?.();
    } catch (err) {
      toast({ title: 'Save failed', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setSavingField(null);
    }
  }, [doc, orgId, onFieldUpdated, toast]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await apiFetcher<{ downloadUrl: string }>(
        buildApiUrl(`/rfp-document/export-form/${doc.documentId}`, { orgId, projectId: doc.projectId, opportunityId: doc.opportunityId }),
      );
      if (result?.downloadUrl) window.open(result.downloadUrl, '_blank');
    } catch (err) {
      toast({ title: 'Export failed', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }, [doc, orgId, toast]);

  // Drag to move field
  const handleMouseDown = useCallback((e: React.MouseEvent, fieldId: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const pos = fieldPositions[fieldId];
    if (!pos) return;
    setDragging({ fieldId, startX: e.clientX, startY: e.clientY, origLeft: pos.left, origTop: pos.top });
  }, [fieldPositions]);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragging.startX) / pageSize.width;
      const dy = (e.clientY - dragging.startY) / pageSize.height;
      setFieldPositions((prev) => ({
        ...prev,
        [dragging.fieldId]: { ...prev[dragging.fieldId]!, left: dragging.origLeft + dx, top: dragging.origTop + dy },
      }));
    };
    const handleUp = () => setDragging(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [dragging, pageSize]);

  // Create new field on double-click
  const handlePageDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>, pageIdx: number) => {
    if (!creatingField) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const left = (e.clientX - rect.left) / rect.width;
    const top = (e.clientY - rect.top) / rect.height;
    const newFieldId = `new-${Date.now()}`;
    const newField: DetectedFormField = {
      fieldId: newFieldId, label: 'New Field', value: null,
      status: 'EMPTY', confidence: null, profileFieldKey: null,
      manualReason: null, pageNumber: pageIdx + 1, cellReference: null,
      boundingBox: { top, left, width: 0.2, height: 0.025 },
    };
    // TODO: save new field to backend
    setFieldPositions((prev) => ({ ...prev, [newFieldId]: newField.boundingBox! }));
    setFieldValues((prev) => ({ ...prev, [newFieldId]: '' }));
    setCreatingField(false);
    setActiveField(newFieldId);
    toast({ title: 'New field created. Type a value and it will be saved.' });
  }, [creatingField, toast]);

  const autoFilled = fields.filter((f) => f.status === 'AUTO_FILLED').length;

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-background shrink-0">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href={backUrl}><ArrowLeft className="h-4 w-4" />Back</Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{doc.name}</p>
        </div>
        <DocumentStatusBadge status={doc.status} />
        <Button
          size="sm"
          variant={creatingField ? 'default' : 'outline'}
          onClick={() => setCreatingField(!creatingField)}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          {creatingField ? 'Click on PDF...' : 'Add Field'}
        </Button>
        <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting} className="gap-1.5">
          {exporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export PDF
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* PDF with overlays */}
        <div className="flex-1 overflow-y-auto bg-gray-200 p-4">
          {pdfLoading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4 flex flex-col items-center">
              {pdfPages.map((dataUrl, pageIdx) => (
                <div
                  key={pageIdx}
                  className={cn('relative bg-white shadow-lg', creatingField && 'cursor-crosshair')}
                  style={{ width: pageSize.width, height: pageSize.height }}
                  onDoubleClick={(e) => handlePageDoubleClick(e, pageIdx)}
                >
                  <img src={dataUrl} alt={`Page ${pageIdx + 1}`} className="w-full h-full pointer-events-none select-none" draggable={false} />

                  {/* Field overlays */}
                  {Object.entries(fieldPositions)
                    .filter(([fid]) => {
                      const f = fields.find((ff) => ff.fieldId === fid);
                      return (f?.pageNumber ?? 1) === pageIdx + 1;
                    })
                    .map(([fid, bbox]) => {
                      const value = fieldValues[fid] ?? '';
                      const isActive = activeField === fid;
                      const field = fields.find((f) => f.fieldId === fid);

                      return (
                        <div
                          key={fid}
                          className={cn(
                            'absolute group',
                            isActive && 'z-10',
                          )}
                          style={{
                            left: `${bbox.left * 100}%`,
                            top: `${bbox.top * 100}%`,
                            width: `${bbox.width * 100}%`,
                            height: `${bbox.height * 100}%`,
                          }}
                        >
                          <input
                            type="text"
                            value={value}
                            onChange={(e) => setFieldValues((prev) => ({ ...prev, [fid]: e.target.value }))}
                            onFocus={() => setActiveField(fid)}
                            onBlur={() => saveField(fid, fieldValues[fid] ?? '')}
                            placeholder={field?.label ?? 'Field'}
                            className={cn(
                              'w-full h-full bg-transparent text-[11px] px-1 outline-none border border-transparent rounded-sm',
                              isActive && 'bg-blue-50/90 border-blue-400 shadow-sm',
                              !isActive && value && 'bg-green-50/70 border-green-300/50',
                              !isActive && !value && 'bg-yellow-50/50 border-yellow-300/30 placeholder:text-gray-400 placeholder:text-[9px]',
                            )}
                            title={field?.label}
                          />
                          {/* Drag handle + delete (visible on hover) */}
                          <div className="absolute -top-4 left-0 hidden group-hover:flex items-center gap-0.5 bg-white shadow rounded px-1 py-0.5 text-[9px]">
                            <button
                              className="cursor-move p-0.5 hover:bg-gray-100 rounded"
                              onMouseDown={(e) => handleMouseDown(e, fid)}
                              title="Drag to move"
                            >
                              <Move className="h-3 w-3 text-gray-500" />
                            </button>
                            <button
                              className="p-0.5 hover:bg-red-50 rounded text-red-500"
                              onClick={() => {
                                setFieldPositions((prev) => { const n = { ...prev }; delete n[fid]; return n; });
                                setFieldValues((prev) => { const n = { ...prev }; delete n[fid]; return n; });
                              }}
                              title="Remove field"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                            <span className="text-gray-400 ml-1 truncate max-w-[80px]">{field?.label}</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Field panel */}
        <div className="w-[300px] border-l flex flex-col overflow-hidden bg-background">
          <div className="px-3 py-2.5 border-b shrink-0">
            <p className="text-xs font-medium text-muted-foreground">{fields.length} fields • {autoFilled} auto-filled</p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y">
            {fields.map((field) => {
              const val = fieldValues[field.fieldId] ?? field.value ?? '';
              const isActive = activeField === field.fieldId;
              return (
                <div
                  key={field.fieldId}
                  className={cn('px-3 py-2 cursor-pointer hover:bg-muted/50 text-xs', isActive && 'bg-blue-50')}
                  onClick={() => setActiveField(field.fieldId)}
                >
                  <p className="font-medium text-muted-foreground truncate">{field.label}</p>
                  <p className={cn('truncate', val ? 'text-foreground' : 'text-muted-foreground italic')}>{val || '—'}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

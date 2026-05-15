'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { Download, RefreshCw, ArrowLeft, Plus, Trash2, Move, GripHorizontal } from 'lucide-react';
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

type FieldUpdate = {
  value?: string | null;
  label?: string;
  boundingBox?: { top: number; left: number; width: number; height: number };
  delete?: boolean;
};

export const PdfFormEditor = ({ doc, orgId, pdfUrl, onFieldUpdated }: PdfFormEditorProps) => {
  const { toast } = useToast();
  const fields = (doc.formFields ?? []) as DetectedFormField[];
  const [activeField, setActiveField] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({});
  const [fieldPositions, setFieldPositions] = useState<Record<string, { top: number; left: number; width: number; height: number }>>({});
  const [exporting, setExporting] = useState(false);
  const [pdfPages, setPdfPages] = useState<string[]>([]);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({ width: 612, height: 792 });
  const [dragging, setDragging] = useState<{ fieldId: string; startX: number; startY: number; origLeft: number; origTop: number } | null>(null);
  const [resizing, setResizing] = useState<{ fieldId: string; startX: number; startY: number; origWidth: number; origHeight: number; dir: 'x' | 'y' | 'xy' } | null>(null);
  const [creatingField, setCreatingField] = useState(false);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const saveTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});

  const backUrl = `/organizations/${orgId}/projects/${doc.projectId}/opportunities/${doc.opportunityId}`;

  useEffect(() => {
    const vals: Record<string, string> = {};
    const labels: Record<string, string> = {};
    const positions: Record<string, { top: number; left: number; width: number; height: number }> = {};
    for (const f of fields) {
      if (f.value) vals[f.fieldId] = f.value;
      labels[f.fieldId] = f.label;
      if (f.boundingBox) positions[f.fieldId] = f.boundingBox;
    }
    setFieldValues(vals);
    setFieldLabels(labels);
    setFieldPositions(positions);
  }, [fields]);

  // Save field update to backend (debounced)
  const saveFieldUpdate = useCallback((fieldId: string, update: FieldUpdate) => {
    if (saveTimeoutRef.current[fieldId]) clearTimeout(saveTimeoutRef.current[fieldId]);
    saveTimeoutRef.current[fieldId] = setTimeout(async () => {
      try {
        await apiMutate(buildApiUrl('/required-forms/field', { orgId }), 'PUT', {
          projectId: doc.projectId, opportunityId: doc.opportunityId,
          documentId: doc.documentId, fieldId, orgId, ...update,
        });
      } catch (err) {
        toast({ title: 'Save failed', description: (err as Error)?.message, variant: 'destructive' });
      }
    }, 300);
  }, [doc, orgId, toast]);

  // Render PDF pages
  useEffect(() => {
    if (!pdfUrl) return;
    const loadPdf = async () => {
      setPdfLoading(true);
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        const pdf = await pdfjsLib.getDocument({ url: pdfUrl, isEvalSupported: false }).promise;
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

  // Drag to move
  const handleDragStart = useCallback((e: React.MouseEvent, fieldId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = fieldPositions[fieldId];
    if (!pos) return;
    setDragging({ fieldId, startX: e.clientX, startY: e.clientY, origLeft: pos.left, origTop: pos.top });
  }, [fieldPositions]);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragging.startX) / pageSize.width;
      const dy = (e.clientY - dragging.startY) / pageSize.height;
      const newPos = { ...fieldPositions[dragging.fieldId]!, left: dragging.origLeft + dx, top: dragging.origTop + dy };
      setFieldPositions((prev) => ({ ...prev, [dragging.fieldId]: newPos }));
    };
    const handleUp = () => {
      const pos = fieldPositions[dragging.fieldId];
      if (pos) saveFieldUpdate(dragging.fieldId, { boundingBox: pos });
      setDragging(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [dragging, pageSize, fieldPositions, saveFieldUpdate]);

  // Resize (horizontal, vertical, or both)
  const handleResizeStart = useCallback((e: React.MouseEvent, fieldId: string, dir: 'x' | 'y' | 'xy') => {
    e.preventDefault();
    e.stopPropagation();
    const pos = fieldPositions[fieldId];
    if (!pos) return;
    setResizing({ fieldId, startX: e.clientX, startY: e.clientY, origWidth: pos.width, origHeight: pos.height, dir });
  }, [fieldPositions]);

  useEffect(() => {
    if (!resizing) return;
    const handleMove = (e: MouseEvent) => {
      const dx = (e.clientX - resizing.startX) / pageSize.width;
      const dy = (e.clientY - resizing.startY) / pageSize.height;
      setFieldPositions((prev) => {
        const curr = prev[resizing.fieldId]!;
        return {
          ...prev,
          [resizing.fieldId]: {
            ...curr,
            width: resizing.dir !== 'y' ? Math.max(0.03, resizing.origWidth + dx) : curr.width,
            height: resizing.dir !== 'x' ? Math.max(0.015, resizing.origHeight + dy) : curr.height,
          },
        };
      });
    };
    const handleUp = () => {
      const pos = fieldPositions[resizing.fieldId];
      if (pos) saveFieldUpdate(resizing.fieldId, { boundingBox: pos });
      setResizing(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [resizing, pageSize, fieldPositions, saveFieldUpdate]);

  // Create field on double-click
  const handleCreateField = useCallback((e: React.MouseEvent<HTMLDivElement>, pageIdx: number) => {
    if (!creatingField) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const left = (e.clientX - rect.left) / rect.width;
    const top = (e.clientY - rect.top) / rect.height;
    const newFieldId = `field-${Date.now()}`;
    const bbox = { top, left, width: 0.2, height: 0.025 };

    setFieldPositions((prev) => ({ ...prev, [newFieldId]: bbox }));
    setFieldValues((prev) => ({ ...prev, [newFieldId]: '' }));
    setFieldLabels((prev) => ({ ...prev, [newFieldId]: 'New Field' }));
    setCreatingField(false);
    setActiveField(newFieldId);

    saveFieldUpdate(newFieldId, { label: 'New Field', value: null, boundingBox: bbox });
  }, [creatingField, saveFieldUpdate]);

  // Delete field
  const handleDeleteField = useCallback((fieldId: string) => {
    setFieldPositions((prev) => { const n = { ...prev }; delete n[fieldId]; return n; });
    setFieldValues((prev) => { const n = { ...prev }; delete n[fieldId]; return n; });
    setFieldLabels((prev) => { const n = { ...prev }; delete n[fieldId]; return n; });
    saveFieldUpdate(fieldId, { delete: true });
  }, [saveFieldUpdate]);

  // Value change (save on blur or debounced)
  const handleValueChange = useCallback((fieldId: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  const handleValueBlur = useCallback((fieldId: string) => {
    saveFieldUpdate(fieldId, { value: fieldValues[fieldId] || null });
  }, [fieldValues, saveFieldUpdate]);

  // Label rename
  const handleLabelChange = useCallback((fieldId: string, label: string) => {
    setFieldLabels((prev) => ({ ...prev, [fieldId]: label }));
  }, []);

  const handleLabelBlur = useCallback((fieldId: string) => {
    setEditingLabel(null);
    saveFieldUpdate(fieldId, { label: fieldLabels[fieldId] });
  }, [fieldLabels, saveFieldUpdate]);

  const filledCount = Object.values(fieldValues).filter((v) => v).length;
  const totalCount = Object.keys(fieldPositions).length;

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
        <Button size="sm" variant={creatingField ? 'default' : 'outline'} onClick={() => setCreatingField(!creatingField)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />{creatingField ? 'Click on PDF...' : 'Add Field'}
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
            <div className="flex items-center justify-center h-full"><RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-4 flex flex-col items-center">
              {pdfPages.map((dataUrl, pageIdx) => (
                <div
                  key={pageIdx}
                  className={cn('relative bg-white shadow-lg', creatingField && 'cursor-crosshair')}
                  style={{ width: pageSize.width, height: pageSize.height }}
                  onDoubleClick={(e) => handleCreateField(e, pageIdx)}
                >
                  <img src={dataUrl} alt={`Page ${pageIdx + 1}`} className="w-full h-full pointer-events-none select-none" draggable={false} />

                  {Object.entries(fieldPositions)
                    .filter(([fid]) => {
                      const f = fields.find((ff) => ff.fieldId === fid);
                      return (f?.pageNumber ?? 1) === pageIdx + 1 || (!f && pageIdx === 0);
                    })
                    .map(([fid, bbox]) => {
                      const value = fieldValues[fid] ?? '';
                      const label = fieldLabels[fid] ?? 'Field';
                      const isActive = activeField === fid;

                      return (
                        <div
                          key={fid}
                          className={cn('absolute group', isActive && 'z-10')}
                          style={{ left: `${bbox.left * 100}%`, top: `${bbox.top * 100}%`, width: `${bbox.width * 100}%`, height: `${bbox.height * 100}%` }}
                        >
                          <input
                            type="text"
                            value={value}
                            onChange={(e) => handleValueChange(fid, e.target.value)}
                            onFocus={() => setActiveField(fid)}
                            onBlur={() => handleValueBlur(fid)}
                            placeholder={label}
                            className={cn(
                              'w-full h-full bg-transparent text-[11px] px-1 outline-none border rounded-sm',
                              isActive && 'bg-blue-50/90 border-blue-400 shadow-sm',
                              !isActive && value && 'bg-green-50/70 border-green-300/60',
                              !isActive && !value && 'bg-yellow-50/40 border-yellow-300/30 placeholder:text-gray-400 placeholder:text-[9px]',
                            )}
                          />
                          {/* Toolbar on hover */}
                          <div className="absolute -top-5 left-0 hidden group-hover:flex items-center gap-0.5 bg-white shadow-md rounded px-1 py-0.5 z-20">
                            <button className="cursor-move p-0.5 hover:bg-gray-100 rounded" onMouseDown={(e) => handleDragStart(e, fid)} title="Move">
                              <Move className="h-3 w-3 text-gray-500" />
                            </button>
                            <button className="p-0.5 hover:bg-red-50 rounded" onClick={() => handleDeleteField(fid)} title="Delete">
                              <Trash2 className="h-3 w-3 text-red-500" />
                            </button>
                            <span className="text-[9px] text-gray-400 ml-1 max-w-[60px] truncate">{label}</span>
                          </div>
                          {/* Resize handles */}
                          <div
                            className="absolute top-0 right-0 w-1.5 h-full cursor-ew-resize opacity-0 group-hover:opacity-100 bg-blue-400/30 hover:bg-blue-400/50"
                            onMouseDown={(e) => handleResizeStart(e, fid, 'x')}
                          />
                          <div
                            className="absolute bottom-0 left-0 w-full h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100 bg-blue-400/30 hover:bg-blue-400/50"
                            onMouseDown={(e) => handleResizeStart(e, fid, 'y')}
                          />
                          <div
                            className="absolute bottom-0 right-0 w-2.5 h-2.5 cursor-nwse-resize opacity-0 group-hover:opacity-100 bg-blue-500/40 hover:bg-blue-500/60 rounded-tl"
                            onMouseDown={(e) => handleResizeStart(e, fid, 'xy')}
                          />
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
            <p className="text-xs font-medium text-muted-foreground">{totalCount} fields &middot; {filledCount} filled</p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y">
            {Object.entries(fieldPositions).map(([fid]) => {
              const val = fieldValues[fid] ?? '';
              const label = fieldLabels[fid] ?? 'Field';
              const isActive = activeField === fid;
              const isEditingLbl = editingLabel === fid;

              return (
                <div key={fid} className={cn('px-3 py-2 text-xs', isActive && 'bg-blue-50/50')}>
                  <div className="flex items-center justify-between">
                    {isEditingLbl ? (
                      <input
                        className="flex-1 text-[11px] font-medium border-b border-blue-400 outline-none bg-transparent"
                        value={label}
                        onChange={(e) => handleLabelChange(fid, e.target.value)}
                        onBlur={() => handleLabelBlur(fid)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleLabelBlur(fid); }}
                        autoFocus
                      />
                    ) : (
                      <p
                        className="font-medium text-muted-foreground truncate cursor-pointer hover:text-foreground"
                        onClick={() => { setEditingLabel(fid); setActiveField(fid); }}
                        title="Click to rename"
                      >
                        {label}
                      </p>
                    )}
                    <button className="p-0.5 hover:bg-red-50 rounded ml-1 shrink-0" onClick={() => handleDeleteField(fid)}>
                      <Trash2 className="h-3 w-3 text-red-400" />
                    </button>
                  </div>
                  {isActive ? (
                    <input
                      className="w-full mt-0.5 text-xs border-b border-blue-300 outline-none bg-transparent"
                      value={val}
                      onChange={(e) => handleValueChange(fid, e.target.value)}
                      onBlur={() => handleValueBlur(fid)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleValueBlur(fid); }}
                      placeholder="Type value..."
                      autoFocus
                    />
                  ) : (
                    <p
                      className={cn('truncate mt-0.5 cursor-pointer', val ? 'text-foreground' : 'text-muted-foreground italic')}
                      onClick={() => setActiveField(fid)}
                    >
                      {val || '— click to edit'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

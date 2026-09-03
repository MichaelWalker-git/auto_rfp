'use client';

import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { highlightFieldById, highlightFormSnippet } from '@/features/compliance-review';
import { FormVersionHistory, FormSidebarTabs, type FormSidebarTab } from '@/features/package-edit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { Download, RefreshCw, ArrowLeft, Plus, Move, AlertTriangle, Loader2, AlertCircle, Sparkles, X, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PermissionDeleteButton } from '@/components/ui/delete-button';
import { usePermission } from '@/components/permission-wrapper';
import { apiMutate, apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import { cn } from '@/lib/utils';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useResizableSidebar } from '../hooks/useResizableSidebar';
import Link from 'next/link';
import type { DetectedFormField, RequiredFormItem } from '@auto-rfp/core';
import { parsePageRange } from '@auto-rfp/core';

interface PdfFormEditorProps {
  doc: RequiredFormItem;
  orgId: string;
  pdfUrl: string | null;
  onFieldUpdated?: () => void;
}

type BBox = { top: number; left: number; width: number; height: number };

// ─── FieldOverlay (memoized) ─────────────────────────────────────────────────

interface FieldOverlayProps {
  fieldId: string;
  bbox: BBox;
  value: string;
  label: string;
  isActive: boolean;
  isManual: boolean;
  manualReason: string | null;
  markType: DetectedFormField['markType'];
  markChar: string | null;
  canEdit: boolean;
  onActivate: (id: string) => void;
  onValueChange: (id: string, value: string) => void;
  onMarkToggle: (id: string) => void;
  onDragStart: (e: React.MouseEvent, id: string) => void;
  onResizeStart: (e: React.MouseEvent, id: string, dir: 'x' | 'y' | 'xy') => void;
  onDelete: (id: string) => void;
}

const FieldOverlay = memo(function FieldOverlay({
  fieldId, bbox, value, label, isActive, isManual, manualReason,
  markType, markChar, canEdit,
  onActivate, onValueChange, onMarkToggle, onDragStart, onResizeStart, onDelete,
}: FieldOverlayProps) {
  // `contain: layout` isolates drag-induced reflow from siblings; the wrapping
  // <div> uses left/top for steady-state position but during drag we only
  // mutate `transform: translate3d(...)` directly on the DOM (see useDragController),
  // so per-frame work is GPU compositor only — no layout, no paint.
  return (
    <div
      id={`field-${fieldId}`}
      className={cn('absolute group', isActive && 'z-10')}
      style={{
        left: `${bbox.left * 100}%`,
        top: `${bbox.top * 100}%`,
        width: `${bbox.width * 100}%`,
        height: `${bbox.height * 100}%`,
        contain: 'layout style',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {canEdit && (
        <div
          className="absolute -top-2 -left-2 w-4 h-4 cursor-move opacity-0 group-hover:opacity-100 bg-violet-500 rounded-full flex items-center justify-center z-10 shadow-sm"
          onMouseDown={(e) => onDragStart(e, fieldId)}
        >
          <Move className="h-2 w-2 text-white" />
        </div>
      )}
      {canEdit && (
        <button
          type="button"
          title="Delete field"
          aria-label="Delete field"
          className="absolute -top-2 -right-2 w-4 h-4 opacity-0 group-hover:opacity-100 bg-red-500 hover:bg-red-600 active:bg-red-700 rounded-full flex items-center justify-center shadow-sm transition-colors z-10"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(fieldId); }}
        >
          <X className="h-2 w-2 text-white" strokeWidth={3} />
        </button>
      )}
      {markType === 'CIRCLE' || markType === 'CHECKBOX' ? (
        <button
          type="button"
          disabled={!canEdit}
          title={!canEdit ? label : `Click to ${markChar ? 'clear mark' : `stamp ${markType === 'CIRCLE' ? '○' : 'X'}`}`}
          onClick={(e) => { e.stopPropagation(); if (canEdit) { onActivate(fieldId); onMarkToggle(fieldId); } }}
          className={cn(
            'w-full h-full flex items-center justify-center rounded-md transition-colors',
            isActive && 'ring-2 ring-violet-400',
            markChar
              ? 'bg-rose-100/80 text-rose-700 ring-1 ring-rose-300'
              : 'bg-amber-50/60 text-amber-700 ring-1 ring-amber-400/60 hover:bg-amber-100/70',
          )}
        >
          <span className="text-[14px] font-bold leading-none">
            {markChar ?? (markType === 'CIRCLE' ? '○' : 'X')}
          </span>
        </button>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => canEdit && onValueChange(fieldId, e.target.value)}
          onFocus={() => onActivate(fieldId)}
          readOnly={!canEdit}
          placeholder={isManual ? (manualReason ?? label) : label}
          title={isManual ? manualReason ?? '' : undefined}
          className={cn(
            'w-full h-full bg-transparent text-[10px] leading-tight px-1.5 outline-none rounded-md transition-colors duration-100',
            !canEdit ? 'cursor-default' : 'cursor-text',
            isActive && canEdit && 'bg-white/95 ring-2 ring-violet-400 shadow-lg text-gray-900',
            !isActive && value && !isManual && 'bg-emerald-50/60 ring-1 ring-emerald-300/40 text-emerald-900',
            !isActive && isManual && 'bg-amber-50/60 ring-1 ring-amber-400/60 placeholder:text-amber-700/80 placeholder:text-[9px]',
            !isActive && !value && !isManual && 'bg-slate-100/40 ring-1 ring-slate-300/30 placeholder:text-slate-400/70 placeholder:text-[9px]',
            canEdit && !isActive && isManual && 'hover:bg-white/60',
            canEdit && !isActive && !value && !isManual && 'hover:bg-white/60 hover:ring-violet-300/50',
          )}
        />
      )}
      {canEdit && (
        <>
          <div className="absolute top-0 -right-1 w-2 h-full cursor-ew-resize opacity-0 group-hover:opacity-100" onMouseDown={(e) => onResizeStart(e, fieldId, 'x')} />
          <div className="absolute -bottom-1 left-0 w-full h-2 cursor-ns-resize opacity-0 group-hover:opacity-100" onMouseDown={(e) => onResizeStart(e, fieldId, 'y')} />
          <div
            className="absolute -bottom-1 -right-1 w-3 h-3 cursor-nwse-resize"
            onMouseDown={(e) => onResizeStart(e, fieldId, 'xy')}
          />
        </>
      )}
    </div>
  );
});

// ─── FieldRow (memoized sidebar item) ────────────────────────────────────────

interface FieldRowProps {
  fieldId: string;
  value: string;
  label: string;
  status: DetectedFormField['status'] | null;
  manualReason: string | null;
  isActive: boolean;
  isEditingLabel: boolean;
  isAiFilling: boolean;
  canEdit: boolean;
  onActivate: (id: string) => void;
  onStartEditLabel: (id: string) => void;
  onLabelChange: (id: string, label: string) => void;
  onLabelBlur: (id: string) => void;
  onValueChange: (id: string, value: string) => void;
  onDelete: (id: string) => void;
  onAiFill: (id: string) => void;
}

const FieldRow = memo(function FieldRow({
  fieldId, value, label, status, manualReason, isActive, isEditingLabel, isAiFilling, canEdit,
  onActivate, onStartEditLabel, onLabelChange, onLabelBlur, onValueChange, onDelete, onAiFill,
}: FieldRowProps) {
  const isLowConfidence = status === 'LOW_CONFIDENCE';
  const isManual = status === 'MANUAL_REQUIRED';
  const isAutoFilled = status === 'AUTO_FILLED';

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (isActive && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isActive]);

  return (
    <div className="px-3 py-2 group/item" onClick={() => onActivate(fieldId)}>
      <div className={cn(
        'rounded-md px-2.5 py-1.5 transition-all',
        isActive && 'bg-white ring-2 ring-violet-400 shadow-sm',
        !isActive && isAutoFilled && 'bg-emerald-50/60 ring-1 ring-emerald-300/50',
        !isActive && isLowConfidence && 'bg-amber-50/60 ring-1 ring-amber-300/60',
        !isActive && isManual && 'bg-amber-50/40 ring-1 ring-amber-400/60',
        !isActive && !status && value && 'bg-emerald-50/60 ring-1 ring-emerald-300/40',
        !isActive && !status && !value && 'bg-slate-100/40 ring-1 ring-slate-300/30 hover:ring-violet-300/50',
      )}>
        <div className="flex items-center justify-between">
          {isEditingLabel && canEdit ? (
            <input
              className="flex-1 text-[10px] font-medium border-b border-violet-400 outline-none bg-transparent text-gray-800"
              value={label}
              onChange={(e) => onLabelChange(fieldId, e.target.value)}
              onBlur={() => onLabelBlur(fieldId)}
              onKeyDown={(e) => { if (e.key === 'Enter') onLabelBlur(fieldId); }}
              autoFocus
            />
          ) : (
            <p
              className={cn('text-[10px] font-medium text-slate-500 truncate', canEdit && 'cursor-pointer hover:text-slate-700')}
              onClick={(e) => { e.stopPropagation(); if (canEdit) onStartEditLabel(fieldId); }}
            >
              {isManual && <AlertTriangle className="inline h-2.5 w-2.5 text-amber-500 mr-0.5 -mt-0.5" />}
              {isLowConfidence && !isManual && <span className="text-amber-500 mr-0.5">⚠</span>}
              {label}
            </p>
          )}
          {canEdit && (
            <div className="flex items-center gap-0.5 ml-1 shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity">
              <button
                title="Fill with AI"
                className="p-0.5 hover:bg-violet-50 rounded disabled:opacity-50"
                disabled={isAiFilling}
                onClick={(e) => { e.stopPropagation(); onAiFill(fieldId); }}
              >
                {isAiFilling
                  ? <Loader2 className="h-2.5 w-2.5 text-violet-500 animate-spin" />
                  : <Sparkles className="h-2.5 w-2.5 text-violet-500" />}
              </button>
              <button title="Delete field" className="p-0.5 hover:bg-red-50 rounded" onClick={(e) => { e.stopPropagation(); onDelete(fieldId); }}>
                <Trash2 className="h-2.5 w-2.5 text-red-400" />
              </button>
            </div>
          )}
        </div>
        {/* Always-mounted input: avoids unmount/mount + focus thrash on active-field switch.
            Visually styled to match the previous <p> when inactive. */}
        <input
          ref={inputRef}
          className={cn(
            'w-full text-[11px] bg-transparent outline-none truncate',
            isActive && canEdit
              ? 'mt-1 border-b border-violet-300 text-gray-900'
              : value
                ? 'mt-0.5 text-emerald-900 cursor-pointer'
                : isManual
                  ? 'mt-0.5 text-amber-700 cursor-pointer'
                  : 'mt-0.5 text-slate-400 italic cursor-pointer',
            !canEdit && 'cursor-default',
          )}
          value={value}
          onChange={(e) => canEdit && onValueChange(fieldId, e.target.value)}
          readOnly={!isActive || !canEdit}
          tabIndex={isActive && canEdit ? 0 : -1}
          placeholder={!canEdit ? (value || '—') : (isActive ? 'Type value...' : (isManual ? (manualReason ?? 'Needs your input') : 'click to edit'))}
        />
        {isManual && manualReason && value && (
          <p className="text-[10px] mt-0.5 text-amber-700/80 italic">{manualReason}</p>
        )}
      </div>
    </div>
  );
});

// ─── Main editor ─────────────────────────────────────────────────────────────

export const PdfFormEditor = ({ doc, orgId, pdfUrl, onFieldUpdated }: PdfFormEditorProps) => {
  const { toast } = useToast();
  const canEdit = usePermission('form:edit');
  const [activeField, setActiveField] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<FormSidebarTab>('fields');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({});
  // Per-field mark char (X / ○ / null). Seeded from server, toggled by FieldOverlay.
  const [fieldMarkChars, setFieldMarkChars] = useState<Record<string, string | null>>({});
  const [fieldPositions, setFieldPositions] = useState<Record<string, BBox>>({});
  // Page assignment for fields not yet on the server (created locally before save).
  // Server fields use doc.fields[].pageNumber; unsaved ones look up here.
  const [localFieldPages, setLocalFieldPages] = useState<Record<string, number>>({});
  const [exporting, setExporting] = useState(false);
  // Each rendered page tracks its 1-indexed page number from the *source* PDF.
  // We render only the form's pages (sourcePageRange), so the array index !=
  // the page number — overlay lookups must use pageNumber, not index+1.
  const [pdfPages, setPdfPages] = useState<{ url: string; pageNumber: number }[]>([]);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({ width: 612, height: 792 });
  const [creatingField, setCreatingField] = useState(false);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [aiFillingIds, setAiFillingIds] = useState<Set<string>>(new Set());
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const { width: sidebarWidth, onResizeStart: handleSidebarResizeStart } = useResizableSidebar({ initial: 320 });

  const backUrl = `/organizations/${orgId}/projects/${doc.projectId}/opportunities/${doc.opportunityId}?tab=required-forms`;

  // Stable lookup map — built once per fields reference, not per render row.
  const fieldsById = useMemo(() => {
    const map = new Map<string, DetectedFormField>();
    for (const f of doc.fields ?? []) map.set(f.fieldId, f);
    return map;
  }, [doc.fields]);

  const fields = useMemo(() => doc.fields ?? [], [doc.fields]);

  // Sync from server doc → local state, but DON'T clobber unsaved edits and
  // DON'T break referential equality of unchanged entries (memoized children rely on it).
  // Reuses prior object refs for any field whose values/positions are unchanged so
  // FieldOverlay.bbox stays === across server polls — otherwise every overlay would
  // re-render on every poll because shallow-prop-compare sees a "new" bbox object.
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  useEffect(() => {
    if (isDirtyRef.current) return;

    const bboxEq = (a: BBox | undefined, b: BBox | null | undefined) =>
      !!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

    setFieldPositions((prev) => {
      const next: Record<string, BBox> = {};
      let changed = false;
      const seen = new Set<string>();
      for (const f of fields) {
        if (!f.boundingBox) continue;
        seen.add(f.fieldId);
        const prior = prev[f.fieldId];
        if (bboxEq(prior, f.boundingBox)) {
          next[f.fieldId] = prior!;
        } else {
          next[f.fieldId] = f.boundingBox;
          changed = true;
        }
      }
      // detect deletions
      for (const k of Object.keys(prev)) if (!seen.has(k)) { changed = true; break; }
      return changed || Object.keys(prev).length !== Object.keys(next).length ? next : prev;
    });

    setFieldValues((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      const seen = new Set<string>();
      for (const f of fields) {
        if (!f.value) continue;
        seen.add(f.fieldId);
        next[f.fieldId] = f.value;
        if (prev[f.fieldId] !== f.value) changed = true;
      }
      for (const k of Object.keys(prev)) if (!seen.has(k)) { changed = true; break; }
      return changed || Object.keys(prev).length !== Object.keys(next).length ? next : prev;
    });

    setFieldLabels((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      const seen = new Set<string>();
      for (const f of fields) {
        seen.add(f.fieldId);
        next[f.fieldId] = f.label;
        if (prev[f.fieldId] !== f.label) changed = true;
      }
      for (const k of Object.keys(prev)) if (!seen.has(k)) { changed = true; break; }
      return changed || Object.keys(prev).length !== Object.keys(next).length ? next : prev;
    });

    setFieldMarkChars((prev) => {
      const next: Record<string, string | null> = {};
      let changed = false;
      const seen = new Set<string>();
      for (const f of fields) {
        if (f.markType !== 'CHECKBOX' && f.markType !== 'CIRCLE') continue;
        seen.add(f.fieldId);
        next[f.fieldId] = f.markChar ?? null;
        if (prev[f.fieldId] !== (f.markChar ?? null)) changed = true;
      }
      for (const k of Object.keys(prev)) if (!seen.has(k)) { changed = true; break; }
      return changed || Object.keys(prev).length !== Object.keys(next).length ? next : prev;
    });
  }, [fields, doc.formId, doc.updatedAt]);

  // Scroll to active field when selected from sidebar.
  // Use 'auto' (instant) — smooth-scroll runs a 300ms main-thread animation that
  // competes with input rendering. Only scroll if the element is offscreen.
  useEffect(() => {
    if (!activeField) return;
    const el = document.getElementById(`field-${activeField}`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const inView = rect.top >= 0 && rect.bottom <= window.innerHeight;
    if (!inView) el.scrollIntoView({ block: 'center' });
  }, [activeField]);

  // Compliance-review deep-link: when opened with ?highlightField / ?findSnippet,
  // activate + flash the referenced field once the PDF pages have rendered.
  // DOM-only (never persisted) so export is unaffected.
  const searchParams = useSearchParams();
  const highlightField = searchParams.get('highlightField');
  const findSnippet = searchParams.get('findSnippet');
  const hasHighlightedRef = useRef(false);
  useEffect(() => {
    if (pdfLoading || hasHighlightedRef.current) return;
    if (!highlightField && !findSnippet) return;
    hasHighlightedRef.current = true;
    // Selecting the field activates its overlay + sidebar row; the flash and
    // snippet fallback run after a short delay so overlays are laid out.
    if (highlightField) setActiveField(highlightField);
    const t = setTimeout(() => {
      if (highlightField && highlightFieldById(highlightField)) return;
      if (findSnippet) highlightFormSnippet(findSnippet);
    }, 300);
    return () => clearTimeout(t);
  }, [pdfLoading, highlightField, findSnippet]);

  // Save all fields in one request
  const handleSaveAll = useCallback(async () => {
    setIsSaving(true);
    try {
      const allFields = Object.entries(fieldPositions).map(([fid, pos]) => {
        const originalField = fieldsById.get(fid);
        const markType = originalField?.markType ?? 'TEXT';
        const markChar = (markType === 'CHECKBOX' || markType === 'CIRCLE')
          ? fieldMarkChars[fid] ?? null
          : originalField?.markChar ?? null;
        return {
          fieldId: fid,
          label: fieldLabels[fid] ?? originalField?.label ?? 'Field',
          value: fieldValues[fid] ?? null,
          status: originalField?.status ?? (fieldValues[fid] ? 'AUTO_FILLED' as const : 'EMPTY' as const),
          confidence: originalField?.confidence ?? null,
          profileFieldKey: originalField?.profileFieldKey ?? null,
          manualReason: originalField?.manualReason ?? null,
          pageNumber: originalField?.pageNumber ?? localFieldPages[fid] ?? 1,
          cellReference: originalField?.cellReference ?? null,
          boundingBox: pos,
          markType,
          markChar,
          markGeometry: originalField?.markGeometry ?? null,
          matrixCategory: originalField?.matrixCategory ?? null,
          matrixFeature: originalField?.matrixFeature ?? null,
          matrixColumn: originalField?.matrixColumn ?? 'OTHER' as const,
        };
      });

      await apiMutate(buildApiUrl('/required-forms/save-fields', { orgId }), 'PUT', {
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        formId: doc.formId,
        fields: allFields,
      });

      setIsDirty(false);
      toast({ title: 'Saved' });
      onFieldUpdated?.();
    } catch (err) {
      toast({ title: 'Save failed', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [fieldPositions, fieldValues, fieldLabels, fieldMarkChars, fieldsById, localFieldPages, doc, orgId, toast, onFieldUpdated]);

  // Toggle the mark on a CHECKBOX/CIRCLE field — sets markChar to 'X'/'○' or clears it.
  const handleMarkToggle = useCallback((fieldId: string) => {
    const original = fieldsById.get(fieldId);
    const desired = original?.markType === 'CIRCLE' ? '○' : 'X';
    setFieldMarkChars((prev) => {
      const current = prev[fieldId] ?? null;
      return { ...prev, [fieldId]: current ? null : desired };
    });
    setIsDirty(true);
  }, [fieldsById]);

  // Mark dirty on any change
  const markDirty = useCallback(() => setIsDirty(true), []);

  // Render PDF pages → Blob URLs (revoked on unmount or pdfUrl change).
  // Avoids holding ~30%-bloated base64 strings in the JS heap for multipage PDFs.
  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;
    const blobUrls: string[] = [];

    const loadPdf = async () => {
      setPdfLoading(true);
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        const pdf = await pdfjsLib.getDocument({ url: pdfUrl, isEvalSupported: false }).promise;
        if (cancelled) return;

        // Limit rendering to the form's own pages. Without this we'd rasterize
        // every page of the source RFP (sometimes 50+) for every form, which
        // is both slow and visually noisy. Falls back to "all pages" when the
        // form has no sourcePageRange (legacy data, single-form PDFs).
        const allowed = parsePageRange(doc.sourcePageRange);
        const pages: { url: string; pageNumber: number }[] = [];
        let pageSizeSet = false;
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          if (allowed && !allowed.has(i)) continue;
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          if (!pageSizeSet) {
            setPageSize({ width: viewport.width, height: viewport.height });
            pageSizeSet = true;
          }
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
          // Release the canvas bitmap immediately
          canvas.width = 0;
          canvas.height = 0;
          if (!blob || cancelled) continue;
          const url = URL.createObjectURL(blob);
          blobUrls.push(url);
          pages.push({ url, pageNumber: i });
        }
        if (!cancelled) setPdfPages(pages);
      } catch (err) {
        console.error('PDF render failed:', err);
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
      for (const u of blobUrls) URL.revokeObjectURL(u);
    };
  }, [pdfUrl, doc.sourcePageRange]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await apiFetcher<{ downloadUrl: string; fileName?: string }>(
        buildApiUrl(`/required-forms/export`, { orgId, projectId: doc.projectId, opportunityId: doc.opportunityId, formId: doc.formId }),
      );
      if (!result?.downloadUrl) return;
      // Trigger a download via a programmatic anchor click. window.open after an
      // await is treated as a popup and blocked by Chrome (the user gesture is
      // already consumed). An <a download> click is a download, not a popup.
      const a = document.createElement('a');
      a.href = result.downloadUrl;
      a.rel = 'noopener';
      a.target = '_blank';
      if (result.fileName) a.download = result.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast({ title: 'Export failed', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }, [doc, orgId, toast]);

  const handleReprocess = useCallback(async () => {
    setReprocessing(true);
    try {
      await apiMutate(
        buildApiUrl('/required-forms/reprocess', { orgId, projectId: doc.projectId, opportunityId: doc.opportunityId, formId: doc.formId }),
        'POST',
        {},
      );
      toast({ title: 'Form reprocessing', description: 'Re-extracting fields. This will take 10–60 seconds.' });
      // Drop local edits so the new server-side fields actually overwrite the
      // local maps (sync effect skips when isDirty is true).
      setIsDirty(false);
      // Trigger an immediate refetch — page-level SWR will then poll until
      // status flips back to READY.
      onFieldUpdated?.();
    } catch (err) {
      toast({ title: 'Reprocess failed', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setReprocessing(false);
    }
  }, [doc, orgId, toast, onFieldUpdated]);

  const handleDeleteForm = useCallback(async () => {
    const ok = await confirm({ title: 'Delete this form?', description: 'This will permanently remove the form and all its fields.', confirmLabel: 'Delete', variant: 'destructive' });
    if (!ok) return;
    try {
      await apiMutate(buildApiUrl('/required-forms/delete', { orgId, projectId: doc.projectId, opportunityId: doc.opportunityId, formId: doc.formId }), 'DELETE');
      toast({ title: 'Form deleted' });
      window.location.href = backUrl;
    } catch (err) {
      toast({ title: 'Delete failed', description: (err as Error)?.message, variant: 'destructive' });
    }
  }, [doc, orgId, toast, backUrl, confirm]);

  // ─── Drag / resize ────────────────────────────────────────────────────────
  // Live state goes through refs and direct DOM mutation; React state is updated
  // ONCE on mouseup. Per-frame work: a single transform write (compositor only).
  // Callbacks have NO state-dependent deps so memoized FieldOverlay never re-renders
  // because of unrelated parent state changes.
  const fieldPositionsRef = useRef(fieldPositions);
  fieldPositionsRef.current = fieldPositions;
  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;

  const dragListenersRef = useRef<{ move: (e: MouseEvent) => void; up: (e: MouseEvent) => void } | null>(null);
  const resizeListenersRef = useRef<{ move: (e: MouseEvent) => void; up: (e: MouseEvent) => void } | null>(null);
  useEffect(() => () => {
    if (dragListenersRef.current) {
      window.removeEventListener('mousemove', dragListenersRef.current.move);
      window.removeEventListener('mouseup', dragListenersRef.current.up);
    }
    if (resizeListenersRef.current) {
      window.removeEventListener('mousemove', resizeListenersRef.current.move);
      window.removeEventListener('mouseup', resizeListenersRef.current.up);
    }
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent, fieldId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = fieldPositionsRef.current[fieldId];
    if (!pos) return;
    const el = document.getElementById(`field-${fieldId}`);
    if (!el) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const origLeft = pos.left;
    const origTop = pos.top;
    let lastDx = 0;
    let lastDy = 0;
    let rafId = 0;
    el.style.willChange = 'transform';

    const flush = () => {
      rafId = 0;
      // translate3d in pixels — 1:1 with mouse movement.
      // Percentages would resolve against the element's own size, not the page.
      el.style.transform = `translate3d(${lastDx}px, ${lastDy}px, 0)`;
    };

    const handleMove = (ev: MouseEvent) => {
      lastDx = ev.clientX - startX;
      lastDy = ev.clientY - startY;
      if (!rafId) rafId = requestAnimationFrame(flush);
    };

    const handleUp = () => {
      if (rafId) cancelAnimationFrame(rafId);
      el.style.transform = '';
      el.style.willChange = '';
      const { width, height } = pageSizeRef.current;
      const dxNorm = lastDx / width;
      const dyNorm = lastDy / height;
      if (dxNorm !== 0 || dyNorm !== 0) {
        setFieldPositions((prev) => ({
          ...prev,
          [fieldId]: { ...prev[fieldId]!, left: origLeft + dxNorm, top: origTop + dyNorm },
        }));
        markDirty();
      }
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      dragListenersRef.current = null;
    };

    dragListenersRef.current = { move: handleMove, up: handleUp };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [markDirty]);

  const handleResizeStart = useCallback((e: React.MouseEvent, fieldId: string, dir: 'x' | 'y' | 'xy') => {
    e.preventDefault();
    e.stopPropagation();
    const pos = fieldPositionsRef.current[fieldId];
    if (!pos) return;
    const el = document.getElementById(`field-${fieldId}`);
    if (!el) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const origWidth = pos.width;
    const origHeight = pos.height;
    let lastDx = 0;
    let lastDy = 0;
    let rafId = 0;
    el.style.willChange = 'width, height';

    const flush = () => {
      rafId = 0;
      const { width, height } = pageSizeRef.current;
      const dxNorm = lastDx / width;
      const dyNorm = lastDy / height;
      const newWidth = dir !== 'y' ? Math.max(0.03, origWidth + dxNorm) : origWidth;
      const newHeight = dir !== 'x' ? Math.max(0.015, origHeight + dyNorm) : origHeight;
      el.style.width = `${newWidth * 100}%`;
      el.style.height = `${newHeight * 100}%`;
    };

    const handleMove = (ev: MouseEvent) => {
      lastDx = ev.clientX - startX;
      lastDy = ev.clientY - startY;
      if (!rafId) rafId = requestAnimationFrame(flush);
    };

    const handleUp = () => {
      if (rafId) cancelAnimationFrame(rafId);
      el.style.willChange = '';
      const { width, height } = pageSizeRef.current;
      const dxNorm = lastDx / width;
      const dyNorm = lastDy / height;
      if (dxNorm !== 0 || dyNorm !== 0) {
        setFieldPositions((prev) => ({
          ...prev,
          [fieldId]: {
            ...prev[fieldId]!,
            width: dir !== 'y' ? Math.max(0.03, origWidth + dxNorm) : prev[fieldId]!.width,
            height: dir !== 'x' ? Math.max(0.015, origHeight + dyNorm) : prev[fieldId]!.height,
          },
        }));
        markDirty();
      }
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      resizeListenersRef.current = null;
    };

    resizeListenersRef.current = { move: handleMove, up: handleUp };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [markDirty]);

  // Create field on single-click while in creating-mode. Center the bbox on the click
  // point and assign it to the page that was clicked (1-indexed). Immediately open
  // the label editor so the user can name it without an extra step.
  const handleCreateField = useCallback((e: React.MouseEvent<HTMLDivElement>, pageNumber: number) => {
    if (!creatingField) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const w = 0.2;
    const h = 0.025;
    const left = Math.max(0, Math.min(1 - w, (e.clientX - rect.left) / rect.width - w / 2));
    const top = Math.max(0, Math.min(1 - h, (e.clientY - rect.top) / rect.height - h / 2));
    const newFieldId = `field-${Date.now()}`;
    const bbox = { top, left, width: w, height: h };

    setFieldPositions((prev) => ({ ...prev, [newFieldId]: bbox }));
    setFieldValues((prev) => ({ ...prev, [newFieldId]: '' }));
    setFieldLabels((prev) => ({ ...prev, [newFieldId]: 'New Field' }));
    setLocalFieldPages((prev) => ({ ...prev, [newFieldId]: pageNumber }));
    setCreatingField(false);
    setActiveField(newFieldId);
    setEditingLabel(newFieldId);
    markDirty();
  }, [creatingField, markDirty]);

  const handleDeleteField = useCallback((fieldId: string) => {
    setFieldPositions((prev) => { const n = { ...prev }; delete n[fieldId]; return n; });
    setFieldValues((prev) => { const n = { ...prev }; delete n[fieldId]; return n; });
    setFieldLabels((prev) => { const n = { ...prev }; delete n[fieldId]; return n; });
    setLocalFieldPages((prev) => { if (!(fieldId in prev)) return prev; const n = { ...prev }; delete n[fieldId]; return n; });
    setActiveField((prev) => (prev === fieldId ? null : prev));
    markDirty();
  }, [markDirty]);

  // Keyboard shortcuts:
  // - Backspace/Delete on an active field (when focus is outside any input) deletes it
  // - Escape cancels Add-Field mode and clears the active field
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (creatingField) setCreatingField(false);
        else setActiveField(null);
        return;
      }
      if (!activeField) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
      if (isEditable) return;
      e.preventDefault();
      handleDeleteField(activeField);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeField, creatingField, handleDeleteField]);

  const handleValueChange = useCallback((fieldId: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
    markDirty();
  }, [markDirty]);

  const handleAiFill = useCallback(async (fieldId: string) => {
    setAiFillingIds((prev) => { const n = new Set(prev); n.add(fieldId); return n; });
    try {
      const result = await apiMutate<{ value: string | null; source: string; confidence: number; reason?: string }>(
        buildApiUrl('/required-forms/ai-fill-field', { orgId }),
        'POST',
        {
          projectId: doc.projectId,
          opportunityId: doc.opportunityId,
          formId: doc.formId,
          fieldId,
          // Send the locally-edited label so the AI uses the user's wording even
          // for fields the user just created or renamed and hasn't saved yet.
          labelOverride: fieldLabels[fieldId],
        },
      );
      if (!result || result.value == null) {
        toast({
          title: 'Could not fill this field',
          description: result?.reason ?? 'No matching value found in your profile or knowledge base.',
        });
        return;
      }
      setFieldValues((prev) => ({ ...prev, [fieldId]: result.value! }));
      setActiveField(fieldId);
      markDirty();
      toast({
        title: result.confidence >= 0.7 ? 'Field filled' : 'Filled with low confidence',
        description: `Source: ${result.source}${result.reason ? ` — ${result.reason}` : ''}`,
      });
    } catch (err) {
      toast({ title: 'AI fill failed', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setAiFillingIds((prev) => { const n = new Set(prev); n.delete(fieldId); return n; });
    }
  }, [doc, orgId, toast, markDirty, fieldLabels]);

  const handleLabelChange = useCallback((fieldId: string, label: string) => {
    setFieldLabels((prev) => ({ ...prev, [fieldId]: label }));
    markDirty();
  }, [markDirty]);

  const handleLabelBlur = useCallback(() => setEditingLabel(null), []);
  const handleStartEditLabel = useCallback((fieldId: string) => {
    setEditingLabel(fieldId);
    setActiveField(fieldId);
  }, []);

  // Group field IDs by page once per (positions, fields) change instead of filtering
  // the whole position map for every page during render.
  const fieldIdsByPage = useMemo(() => {
    const groups = new Map<number, string[]>();
    for (const [fid] of Object.entries(fieldPositions)) {
      const f = fieldsById.get(fid);
      const page = f?.pageNumber ?? localFieldPages[fid] ?? 1;
      const arr = groups.get(page);
      if (arr) arr.push(fid);
      else groups.set(page, [fid]);
    }
    return groups;
  }, [fieldPositions, fieldsById, localFieldPages]);

  const filledCount = useMemo(() => Object.values(fieldValues).filter((v) => v).length, [fieldValues]);
  const totalCount = Object.keys(fieldPositions).length;
  const isProcessing = reprocessing || doc.status === 'IN_PROGRESS';
  const isFailed = doc.status === 'FAILED';
  const manualCount = useMemo(() => fields.filter((f) => f.status === 'MANUAL_REQUIRED').length, [fields]);
  const autoFilledCount = useMemo(() => fields.filter((f) => f.status === 'AUTO_FILLED').length, [fields]);

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
        <Badge variant="outline" className="text-xs">{doc.status}</Badge>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={async () => { const ok = await confirm({ title: 'Reprocess form?', description: 'This will re-extract all fields and re-fill from company profile. Any manual edits will be lost.', confirmLabel: 'Reprocess', variant: 'destructive' }); if (ok) handleReprocess(); }} disabled={reprocessing || isProcessing} className="gap-1.5">
            <RefreshCw className={cn('h-3.5 w-3.5', (reprocessing || isProcessing) && 'animate-spin')} />
            Reprocess
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant={creatingField ? 'default' : 'outline'} onClick={() => setCreatingField(!creatingField)} disabled={isProcessing} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />{creatingField ? 'Click on PDF...' : 'Add Field'}
          </Button>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting || isProcessing || isDirty} className="gap-1.5">
                  {exporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Export PDF
                </Button>
              </span>
            </TooltipTrigger>
            {(isDirty || isProcessing) && (
              <TooltipContent side="top">
                <p>{isProcessing ? 'Wait for processing to complete' : 'Save the form before exporting'}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
        <Button size="sm" variant={isDirty ? 'default' : 'outline'} onClick={handleSaveAll} disabled={isSaving || !isDirty || isProcessing} className="gap-1.5">
          {isSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </Button>
        <PermissionDeleteButton
          requiredPermission="org:delete"
          onClick={handleDeleteForm}
          size="sm"
          variant="ghost"
          className="text-red-500 hover:text-red-700 hover:bg-red-50"
          ariaLabel="Delete form"
          deniedTooltip="Only admins can delete required forms."
        />
      </div>

      {isProcessing && (
        <div className="flex items-center gap-2 px-4 py-2 bg-violet-50 border-b border-violet-200 text-xs text-violet-900">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Analyzing form with Textract — fields will appear here once extraction finishes. This typically takes 10–60 seconds.</span>
        </div>
      )}

      {isFailed && (
        <div className="flex items-start gap-2 px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-900">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">Form analysis failed</p>
            {doc.errorMessage ? <p className="mt-0.5 text-red-700/90">{doc.errorMessage}</p> : null}
          </div>
          <Button size="sm" variant="outline" onClick={handleReprocess} className="h-6 gap-1.5 text-xs">
            <RefreshCw className={cn('h-3 w-3', reprocessing && 'animate-spin')} /> Retry
          </Button>
        </div>
      )}

      {creatingField && (
        <div className="flex items-center justify-between gap-2 px-4 py-2 bg-violet-100 border-b border-violet-300 text-xs text-violet-900">
          <div className="flex items-center gap-2">
            <Plus className="h-3.5 w-3.5" />
            <span>Click anywhere on the PDF to drop a new field. Press <kbd className="px-1 py-0.5 rounded bg-white text-[10px] font-mono">Esc</kbd> to cancel.</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setCreatingField(false)} className="h-6 text-xs">Cancel</Button>
        </div>
      )}

      <div className={cn('flex flex-1 overflow-hidden relative', isProcessing && 'opacity-50 pointer-events-none')}>
        {/* PDF with overlays */}
        <div className="flex-1 overflow-y-auto bg-gray-200 p-4" onClick={() => { if (!creatingField) setActiveField(null); }}>
          {pdfLoading ? (
            <div className="space-y-4 flex flex-col items-center">
              <Skeleton style={{ width: pageSize.width, height: pageSize.height }} className="rounded-md" />
            </div>
          ) : (
            <div className="space-y-4 flex flex-col items-center">
              {pdfPages.map(({ url, pageNumber }, pageIdx) => {
                const ids = fieldIdsByPage.get(pageNumber) ?? (pageIdx === 0 ? (fieldIdsByPage.get(0) ?? []) : []);
                return (
                  <div
                    key={pageNumber}
                    className={cn('relative bg-white shadow-lg', creatingField && 'cursor-crosshair ring-2 ring-violet-400 ring-offset-2')}
                    style={{ width: pageSize.width, height: pageSize.height }}
                    onClick={creatingField ? (e) => handleCreateField(e, pageNumber) : undefined}
                  >
                    <img src={url} alt={`Page ${pageNumber}`} className="w-full h-full pointer-events-none select-none" draggable={false} />
                    {ids.map((fid) => {
                      const bbox = fieldPositions[fid];
                      if (!bbox) return null;
                      const f = fieldsById.get(fid);
                      return (
                        <FieldOverlay
                          key={fid}
                          fieldId={fid}
                          bbox={bbox}
                          value={fieldValues[fid] ?? ''}
                          label={fieldLabels[fid] ?? 'Field'}
                          isActive={activeField === fid}
                          isManual={f?.status === 'MANUAL_REQUIRED'}
                          manualReason={f?.manualReason ?? null}
                          markType={f?.markType ?? 'TEXT'}
                          markChar={fieldMarkChars[fid] ?? null}
                          canEdit={canEdit}
                          onActivate={setActiveField}
                          onValueChange={handleValueChange}
                          onMarkToggle={handleMarkToggle}
                          onDragStart={handleDragStart}
                          onResizeStart={handleResizeStart}
                          onDelete={handleDeleteField}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Drag handle to resize the field panel. */}
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={handleSidebarResizeStart}
          className="w-1 shrink-0 cursor-ew-resize bg-border transition-colors hover:bg-indigo-400"
          title="Drag to resize"
        />

        {/* Right: Field panel (user-resizable) */}
        <div className="border-l flex flex-col overflow-hidden bg-white shrink-0" style={{ width: sidebarWidth }}>
          <div className="px-4 py-3 border-b shrink-0 bg-gray-50/80">
            <div className="flex items-center justify-between gap-2">
              <FormSidebarTabs value={sidebarTab} onChange={setSidebarTab} />
              {sidebarTab === 'fields' && (
                <p className="text-[10px] text-gray-500">{filledCount}/{totalCount} filled</p>
              )}
            </div>
            {sidebarTab === 'fields' && (autoFilledCount > 0 || manualCount > 0) && (
              <div className="flex gap-3 mt-1.5 text-[10px]">
                {autoFilledCount > 0 && <span className="text-emerald-700">{autoFilledCount} auto-filled</span>}
                {manualCount > 0 && <span className="text-amber-700">{manualCount} need you</span>}
              </div>
            )}
          </div>
          {sidebarTab === 'history' ? (
            <div className="flex-1 overflow-y-auto p-3">
              <FormVersionHistory
                orgId={orgId}
                projectId={doc.projectId}
                oppId={doc.opportunityId}
                formId={doc.formId}
                onReverted={() => onFieldUpdated?.()}
              />
            </div>
          ) : (
          <div className="flex-1 overflow-y-auto">
            {totalCount === 0 && !pdfLoading && !isProcessing && (
              <div className="px-4 py-8 text-center text-xs text-slate-500">
                <p className="mb-2">No fields detected on this form.</p>
                <p className="mb-3 text-slate-400">Some forms have blanks that Textract can't see — click the button below, then click on the PDF where you'd write.</p>
                <Button size="sm" variant="outline" onClick={() => setCreatingField(true)} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Add a field
                </Button>
              </div>
            )}
            {Object.keys(fieldPositions).map((fid) => {
              const f = fieldsById.get(fid);
              return (
                <FieldRow
                  key={fid}
                  fieldId={fid}
                  value={fieldValues[fid] ?? ''}
                  label={fieldLabels[fid] ?? 'Field'}
                  status={f?.status ?? null}
                  manualReason={f?.manualReason ?? null}
                  isActive={activeField === fid}
                  isEditingLabel={editingLabel === fid}
                  isAiFilling={aiFillingIds.has(fid)}
                  canEdit={canEdit}
                  onActivate={setActiveField}
                  onStartEditLabel={handleStartEditLabel}
                  onLabelChange={handleLabelChange}
                  onLabelBlur={handleLabelBlur}
                  onValueChange={handleValueChange}
                  onDelete={handleDeleteField}
                  onAiFill={handleAiFill}
                />
              );
            })}
          </div>
          )}
        </div>
      </div>

      <ConfirmDialog />
    </div>
  );
};

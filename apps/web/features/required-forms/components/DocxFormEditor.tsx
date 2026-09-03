'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { Download, RefreshCw, ArrowLeft, AlertTriangle, FileText, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PermissionDeleteButton } from '@/components/ui/delete-button';
import { usePermission } from '@/components/permission-wrapper';
import { apiMutate, apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import { cn } from '@/lib/utils';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useResizableSidebar } from '../hooks/useResizableSidebar';
import Link from 'next/link';
import type { DetectedFormField, RequiredFormItem } from '@auto-rfp/core';
import { FormVersionHistory, FormSidebarTabs, type FormSidebarTab } from '@/features/package-edit';

interface DocxFormEditorProps {
  doc: RequiredFormItem;
  orgId: string;
  onFieldUpdated?: () => void;
}

/**
 * Two-panel editor for DOCX forms: the rendered source document on the left
 * (mammoth→HTML, sanitized) so the user can see WHERE each field sits — essential
 * for telling duplicate label blanks apart (e.g. two "Name:" signature lines) —
 * and the field list on the right. Values come from company-profile autofill;
 * MANUAL_REQUIRED fields (signatures, dates) are flagged. On export, filled
 * fields are written into the original document and empty ones are left blank.
 */
// The render endpoint injects invisible markers (U+E000{index}U+E001) at each
// fill spot BEFORE mammoth, so they survive into the HTML at the right position.
// Kept in sync with apps/functions/src/helpers/docx-fill-spots.ts.
const MARKER_RE = /(\d+)/g;

// Server spot metadata, index-aligned with the injected markers.
interface RenderSpot { kind: string; ref: string; occurrence: number; label: string }

// Match a rendered spot to a sidebar field by its anchor (kind, ref, occurrence).
const spotMatchesField = (spot: RenderSpot, f: DetectedFormField): boolean => {
  const a = f.docxAnchor;
  if (!a) return false;
  if (a.kind !== spot.kind || a.ref !== spot.ref) return false;
  // TEXT_TOKEN is deduped to one field (occurrence null) but can mark many spots.
  if (a.kind === 'TEXT_TOKEN') return true;
  return (a.occurrence ?? 0) === spot.occurrence;
};

export const DocxFormEditor = ({ doc, orgId, onFieldUpdated }: DocxFormEditorProps) => {
  const { toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const canEdit = usePermission('form:edit');

  const [values, setValues] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [renderLoading, setRenderLoading] = useState(true);
  const [renderSpots, setRenderSpots] = useState<RenderSpot[]>([]);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<FormSidebarTab>('fields');
  const { width: sidebarWidth, onResizeStart: handleResizeStart } = useResizableSidebar({ initial: 360 });
  const docRef = useRef<HTMLDivElement | null>(null);
  const fieldRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const fields = (doc.fields ?? []) as DetectedFormField[];
  const backUrl = `/organizations/${orgId}/projects/${doc.projectId}/opportunities/${doc.opportunityId}?tab=required-forms`;

  // marker index → sidebar fieldId (so a doc marker knows which field it shows).
  const markerFieldId = useMemo(() => {
    const map: Record<number, string> = {};
    renderSpots.forEach((spot, i) => {
      const f = fields.find((ff) => spotMatchesField(spot, ff));
      if (f) map[i] = f.fieldId;
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderSpots, doc.formId, doc.updatedAt]);

  // Replace each marker with a placeholder span the decoration effect populates.
  // Done after sanitize (markers are plain text, so they pass through dompurify).
  const decoratedHtml = useMemo(() => {
    if (!renderedHtml) return null;
    return renderedHtml.replace(MARKER_RE, (_m, idx: string) => {
      const fieldId = markerFieldId[Number(idx)];
      if (!fieldId) return ''; // unmatched marker → render nothing
      return `<span class="af-field" data-af-field-id="${fieldId}"></span>`;
    });
  }, [renderedHtml, markerFieldId]);

  // Fetch the rendered document HTML + spot metadata. Re-fetch when the form
  // changes (reprocess can alter the source).
  useEffect(() => {
    let cancelled = false;
    setRenderLoading(true);
    apiFetcher<{ html: string; spots?: RenderSpot[] }>(
      buildApiUrl('/required-forms/render', { orgId, projectId: doc.projectId, opportunityId: doc.opportunityId, formId: doc.formId }),
    )
      .then((res) => {
        if (cancelled) return;
        setRenderedHtml(res?.html ? DOMPurify.sanitize(res.html) : null);
        setRenderSpots(res?.spots ?? []);
      })
      .catch(() => {
        if (!cancelled) { setRenderedHtml(null); setRenderSpots([]); }
      })
      .finally(() => {
        if (!cancelled) setRenderLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.formId, doc.updatedAt]);

  // Seed local values from the server fields whenever they change (poll / reprocess).
  // For checkboxes the tick state lives in markChar; treat present markChar as ticked.
  useEffect(() => {
    const seeded: Record<string, string> = {};
    for (const f of fields) {
      seeded[f.fieldId] = f.markType === 'CHECKBOX' ? (f.markChar ?? '') : (f.value ?? '');
    }
    setValues(seeded);
    setIsDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.formId, doc.updatedAt]);

  const handleValueChange = useCallback((fieldId: string, value: string) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    setIsDirty(true);
  }, []);

  // Clicking a field in the document activates it and scrolls its sidebar row in.
  const handleActivateField = useCallback((fieldId: string) => {
    setActiveFieldId(fieldId);
    fieldRowRefs.current[fieldId]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  // Decorate the in-document field spans: fill each with its live value (or a
  // placeholder), reflect the active highlight, and wire click-to-activate. Runs
  // imperatively because the spans live inside the mammoth HTML (incl. tables),
  // which React doesn't own. Re-runs on value/active/HTML changes.
  const fieldById = useMemo(() => {
    const m: Record<string, DetectedFormField> = {};
    for (const f of fields) m[f.fieldId] = f;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.formId, doc.updatedAt]);

  useEffect(() => {
    const root = docRef.current;
    if (!root) return;
    const spans = root.querySelectorAll<HTMLElement>('.af-field');
    const cleanups: Array<() => void> = [];
    spans.forEach((span) => {
      const fieldId = span.getAttribute('data-af-field-id');
      if (!fieldId) return;
      const value = values[fieldId] ?? '';
      const isCheckbox = fieldById[fieldId]?.markType === 'CHECKBOX';
      const ticked = Boolean(value);
      if (isCheckbox) {
        span.textContent = ticked ? '☒' : '☐'; // checked / empty box
        span.classList.add('af-field--checkbox');
      } else {
        span.textContent = value || '    '; // figure-spaces show the empty slot
      }
      span.classList.toggle('af-field--filled', ticked);
      span.classList.toggle('af-field--empty', !ticked);
      span.classList.toggle('af-field--active', activeFieldId === fieldId);
      const onClick = (e: MouseEvent) => {
        e.preventDefault();
        handleActivateField(fieldId);
        if (isCheckbox && canEdit) {
          setValues((prev) => ({ ...prev, [fieldId]: prev[fieldId] ? '' : '☒' }));
          setIsDirty(true);
        }
      };
      span.addEventListener('click', onClick);
      cleanups.push(() => span.removeEventListener('click', onClick));
    });
    return () => cleanups.forEach((fn) => fn());
  }, [decoratedHtml, values, activeFieldId, handleActivateField, fieldById, canEdit]);

  const handleSaveAll = useCallback(async () => {
    setIsSaving(true);
    try {
      const allFields = fields.map((f) => {
        const local = values[f.fieldId] ?? '';
        if (f.markType === 'CHECKBOX') {
          // Checkbox tick state lives in markChar (☒ when ticked); mirror a
          // truthy marker into value so counts/AUTO_FILLED logic still works.
          const ticked = Boolean(local);
          const markChar = ticked ? (f.markChar || '☒') : null;
          const status = f.status === 'EMPTY' && ticked ? ('AUTO_FILLED' as const) : f.status;
          return { ...f, markChar, value: ticked ? markChar : null, status };
        }
        const value = local || f.value || null;
        // A previously-empty field that now has a value becomes AUTO_FILLED
        // (user-entered). Keep MANUAL_REQUIRED / AUTO_FILLED as-is otherwise.
        const status = f.status === 'EMPTY' && value ? ('AUTO_FILLED' as const) : f.status;
        return { ...f, value, status };
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
  }, [fields, values, doc, orgId, toast, onFieldUpdated]);

  const handleReprocess = useCallback(async () => {
    const ok = await confirm({
      title: 'Reprocess form?',
      description: 'This will re-extract fields and re-fill. Manual edits will be lost.',
      confirmLabel: 'Reprocess',
      variant: 'destructive',
    });
    if (!ok) return;
    setReprocessing(true);
    try {
      await apiMutate(buildApiUrl('/required-forms/reprocess', { orgId, projectId: doc.projectId, opportunityId: doc.opportunityId, formId: doc.formId }), 'POST', {});
      toast({ title: 'Form reprocessed' });
      onFieldUpdated?.();
    } catch (err) {
      toast({ title: 'Reprocess failed', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setReprocessing(false);
    }
  }, [doc, orgId, toast, onFieldUpdated, confirm]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await apiFetcher<{ downloadUrl: string }>(
        buildApiUrl('/required-forms/export', { orgId, projectId: doc.projectId, opportunityId: doc.opportunityId, formId: doc.formId }),
      );
      if (result?.downloadUrl) window.open(result.downloadUrl, '_blank');
    } catch (err) {
      toast({ title: 'Export failed', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }, [doc, orgId, toast]);

  const handleDeleteForm = useCallback(async () => {
    const ok = await confirm({
      title: 'Delete this form?',
      description: 'This will permanently remove the form and all its fields.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiMutate(buildApiUrl('/required-forms/delete', { orgId, projectId: doc.projectId, opportunityId: doc.opportunityId, formId: doc.formId }), 'DELETE');
      toast({ title: 'Form deleted' });
      window.location.href = backUrl;
    } catch (err) {
      toast({ title: 'Delete failed', description: (err as Error)?.message, variant: 'destructive' });
    }
  }, [doc, orgId, toast, backUrl, confirm]);

  const filledCount = fields.filter((f) => (values[f.fieldId] ?? f.value)).length;
  const manualCount = fields.filter((f) => f.status === 'MANUAL_REQUIRED').length;
  // TEXT_TOKEN forms fill inline placeholders (e.g. "[INSERT SUPPLIER NAME]") in
  // the original document. Some listed fields (signatures/dates) have no
  // placeholder to fill, so they must be completed manually in the exported doc.
  const isTextToken = doc.docxFillStrategy === 'TEXT_TOKEN';
  // A field with no docxAnchor has no fillable spot in the document — its value
  // is recorded but can't be written into the export automatically.
  const unanchoredCount = fields.filter((f) => !f.docxAnchor).length;

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-background shrink-0">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href={backUrl}><ArrowLeft className="h-4 w-4" />Back</Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{doc.name}</p>
          <p className="text-xs text-muted-foreground">{doc.sourceFileName}</p>
        </div>
        <Badge variant="outline" className="text-xs">{doc.status}</Badge>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={handleReprocess} disabled={reprocessing} className="gap-1.5">
            <RefreshCw className={cn('h-3.5 w-3.5', reprocessing && 'animate-spin')} />
            Reprocess
          </Button>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting || reprocessing || isDirty} className="gap-1.5">
                  {exporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Export
                </Button>
              </span>
            </TooltipTrigger>
            {(isDirty || reprocessing) && (
              <TooltipContent side="top">
                <p>{reprocessing ? 'Wait for processing to complete' : 'Save the form before exporting'}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
        <Button size="sm" variant={isDirty ? 'default' : 'outline'} onClick={handleSaveAll} disabled={isSaving || !isDirty || reprocessing} className="gap-1.5">
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

      <div className={cn('flex flex-1 min-h-0', reprocessing && 'opacity-50 pointer-events-none')}>
        {/* Left: rendered document so the user can see where each field lives. */}
        <div className="flex-1 overflow-y-auto bg-gray-100 min-w-0">
          <div className="mx-auto my-6 max-w-3xl rounded-lg border bg-white px-10 py-8 shadow-sm">
            {renderLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : decoratedHtml ? (
              <div
                ref={docRef}
                className="docx-render text-[13px] leading-relaxed text-slate-900"
                // Sanitized with DOMPurify; markers replaced with field spans.
                dangerouslySetInnerHTML={{ __html: decoratedHtml }}
              />
            ) : (
              <div className="py-10 text-center">
                <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Preview unavailable for this document.</p>
                <p className="mt-1 text-xs text-slate-400">You can still fill fields on the right and Export.</p>
              </div>
            )}
          </div>
        </div>

        {/* Drag handle to resize the sidebar. */}
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={handleResizeStart}
          className="w-1 shrink-0 cursor-ew-resize bg-border transition-colors hover:bg-indigo-400"
          title="Drag to resize"
        />

        {/* Right: field sidebar (user-resizable). */}
        <div className="shrink-0 overflow-y-auto border-l bg-gray-50" style={{ width: sidebarWidth }}>
          <div className="px-4 py-6">
            <div className="mb-4">
              <FormSidebarTabs value={sidebarTab} onChange={setSidebarTab} />
            </div>

            {sidebarTab === 'history' ? (
              <FormVersionHistory
                orgId={orgId}
                projectId={doc.projectId}
                oppId={doc.opportunityId}
                formId={doc.formId}
                onReverted={() => onFieldUpdated?.()}
              />
            ) : (
            <>
            {doc.status === 'FAILED' && doc.errorMessage && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div><p className="font-medium">Form processing failed</p><p className="mt-0.5 text-red-700/90">{doc.errorMessage}</p></div>
              </div>
            )}

            {isTextToken && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <p>
                  Export fills the placeholders in your original document, keeping its exact
                  formatting.
                  {unanchoredCount > 0 && (
                    <> {unanchoredCount} field{unanchoredCount === 1 ? '' : 's'} (e.g. signatures/dates)
                    {' '}have no placeholder to fill and must be completed manually in the exported file.</>
                  )}
                </p>
              </div>
            )}

            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-700">Fields</p>
              <p className="text-[11px] text-gray-500">
                {filledCount}/{fields.length} filled{manualCount > 0 ? ` · ${manualCount} need you` : ''}
              </p>
            </div>

            {fields.length === 0 ? (
              <div className="rounded-lg border bg-white px-4 py-10 text-center">
                <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No fillable fields were detected in this document.</p>
                <p className="mt-1 text-xs text-slate-400">Use Reprocess to try again, or Export to download the document.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {fields.map((f) => {
                  const isManual = f.status === 'MANUAL_REQUIRED';
                  const isAutoFilled = f.status === 'AUTO_FILLED';
                  const value = values[f.fieldId] ?? '';
                  const isActive = activeFieldId === f.fieldId;
                  const hasSpot = renderSpots.some((s) => spotMatchesField(s, f));
                  const isCheckbox = f.markType === 'CHECKBOX';
                  const ticked = Boolean(value);
                  return (
                    <div
                      key={f.fieldId}
                      ref={(el) => { fieldRowRefs.current[f.fieldId] = el; }}
                      onMouseEnter={() => hasSpot && setActiveFieldId(f.fieldId)}
                      className={cn(
                        'rounded-lg border bg-white px-3 py-2.5 transition-shadow',
                        isManual && !isCheckbox && 'border-amber-300/70',
                        isAutoFilled && 'border-emerald-300/60',
                        isActive && 'ring-2 ring-indigo-400 border-indigo-300',
                      )}
                    >
                      {isCheckbox ? (
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => {
                            if (!canEdit) return;
                            handleActivateField(f.fieldId);
                            handleValueChange(f.fieldId, ticked ? '' : '☒');
                          }}
                          className="flex w-full items-center gap-2 text-left disabled:cursor-not-allowed"
                        >
                          <span className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[11px] leading-none',
                            ticked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-400 text-transparent',
                          )}>
                            ✓
                          </span>
                          <span className="text-xs text-slate-700">{f.label}</span>
                        </button>
                      ) : (
                        <>
                          <div className="mb-1 flex items-center gap-1.5">
                            {isManual && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                            <label className="text-[11px] font-medium text-slate-600">{f.label}</label>
                            {isAutoFilled && (
                              <Badge variant="secondary" className="ml-auto bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                                Auto-filled
                              </Badge>
                            )}
                          </div>
                          <Input
                            value={value}
                            readOnly={!canEdit}
                            onFocus={() => hasSpot && handleActivateField(f.fieldId)}
                            onChange={(e) => handleValueChange(f.fieldId, e.target.value)}
                            placeholder={isManual ? (f.manualReason ?? 'Needs your input') : 'Enter value'}
                            className={cn('h-8 text-sm', isManual && !value && 'placeholder:text-amber-600/70')}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            </>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog />
    </div>
  );
};

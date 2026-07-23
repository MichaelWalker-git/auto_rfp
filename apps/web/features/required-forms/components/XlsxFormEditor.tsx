'use client';

import { useState, useCallback, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { Download, RefreshCw, ArrowLeft, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PermissionDeleteButton } from '@/components/ui/delete-button';
import { usePermission } from '@/components/permission-wrapper';
import { apiMutate, apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import { cn } from '@/lib/utils';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import type { DetectedFormField, RequiredFormItem } from '@auto-rfp/core';

interface XlsxFormEditorProps {
  doc: RequiredFormItem;
  orgId: string;
  onFieldUpdated?: () => void;
}

type CellData = {
  value: string;
  isEditable: boolean;
  fieldId?: string;
  isHeader: boolean;
  isCategoryRow: boolean;
  markType?: DetectedFormField['markType'];
};

// Grids are keyed by worksheet name so multi-sheet workbooks (e.g. instructions
// on sheet 1, the actual form matrix on sheet 2+) each render under their own tab.
type SheetGrids = Record<string, CellData[][]>;

export const XlsxFormEditor = ({ doc, orgId, onFieldUpdated }: XlsxFormEditorProps) => {
  const { toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const canEdit = usePermission('form:edit');
  const fields = (doc.fields ?? []) as DetectedFormField[];
  const [grids, setGrids] = useState<SheetGrids>({});
  const [sheetTabs, setSheetTabs] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');
  // fieldId → resolved sheet name, computed against the real workbook during
  // load. The sidebar filter reads this so it can never disagree with the grid
  // (sheetIndex indexes the full workbook, not the filtered tab list).
  const [fieldSheetById, setFieldSheetById] = useState<Record<string, string>>({});
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [editingSidebarField, setEditingSidebarField] = useState<string | null>(null);
  const [sidebarValues, setSidebarValues] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [deletedFieldIds, setDeletedFieldIds] = useState<Set<string>>(new Set());

  const backUrl = `/organizations/${orgId}/projects/${doc.projectId}/opportunities/${doc.opportunityId}`;

  const grid = grids[activeSheet] ?? [];

  // Load the actual XLSX from S3 and render one grid per sheet that owns fields.
  useEffect(() => {
    const loadXlsx = async () => {
      setLoading(true);
      try {
        const presign = await apiMutate<{ url: string }>(
          buildApiUrl('/presigned/generate-presigned-url'),
          'POST',
          { operation: 'download', key: doc.sourceFileKey },
        );
        if (!presign?.url) throw new Error('Failed to get file URL');

        const response = await fetch(presign.url);
        const arrayBuffer = await response.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        if (workbook.SheetNames.length === 0) throw new Error('No sheet found');

        // Resolve which worksheet a field lives on. Mirrors the backend filler:
        // prefer the explicit name, then the captured index, then sheet 0 for
        // legacy fields that predate multi-sheet support.
        const resolveFieldSheet = (f: DetectedFormField): string => {
          if (f.sheetName && workbook.Sheets[f.sheetName]) return f.sheetName;
          if (f.sheetIndex !== null && f.sheetIndex !== undefined && workbook.SheetNames[f.sheetIndex]) {
            return workbook.SheetNames[f.sheetIndex];
          }
          return workbook.SheetNames[0];
        };

        // Group fields by their resolved sheet, and record the resolution per
        // field so the sidebar can scope itself using the exact same mapping.
        const fieldsBySheet = new Map<string, DetectedFormField[]>();
        const sheetByField: Record<string, string> = {};
        for (const f of fields) {
          const sheetName = resolveFieldSheet(f);
          const bucket = fieldsBySheet.get(sheetName) ?? [];
          bucket.push(f);
          fieldsBySheet.set(sheetName, bucket);
          sheetByField[f.fieldId] = sheetName;
        }

        // Only show sheets that actually own fields, preserving workbook order.
        // Fall back to the first sheet if nothing matched (e.g. empty extraction).
        let tabs = workbook.SheetNames.filter((name) => fieldsBySheet.has(name));
        if (tabs.length === 0) tabs = [workbook.SheetNames[0]];

        const nextGrids: SheetGrids = {};

        for (const sheetName of tabs) {
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) continue;

          const sheetFieldByRef = new Map<string, DetectedFormField>();
          for (const f of fieldsBySheet.get(sheetName) ?? []) {
            if (f.cellReference) sheetFieldByRef.set(f.cellReference, f);
          }

          const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

          let lastRow = 0;
          for (let r = 0; r < jsonData.length; r++) {
            const row = jsonData[r] ?? [];
            if ((row as unknown[]).some((cell) => cell !== undefined && cell !== null && String(cell).trim() !== '')) {
              lastRow = r;
            }
          }

          const maxCols = Math.max(...jsonData.slice(0, lastRow + 1).map((r) => (r as unknown[]).length), 1);
          const rows: CellData[][] = [];

          for (let r = 0; r <= lastRow; r++) {
            const rowData = (jsonData[r] ?? []) as unknown[];
            const row: CellData[] = [];

            const isHeaderRow = rowData.some((c) => typeof c === 'string' && /^(category|feature|fully meets|partially meets|cannot meet)/i.test(c.trim()));

            const nonEmpty = rowData.filter((c) => c !== undefined && c !== null && String(c).trim() !== '');
            const isCategoryRow = nonEmpty.length === 1 && maxCols > 3;

            for (let c = 0; c < maxCols; c++) {
              const cellValue = rowData[c] !== undefined && rowData[c] !== null ? String(rowData[c]) : '';
              const cellRef = XLSX.utils.encode_cell({ r, c });
              const field = sheetFieldByRef.get(cellRef);

              row.push({
                value: field?.value ?? cellValue,
                isEditable: !!field,
                fieldId: field?.fieldId,
                isHeader: isHeaderRow,
                isCategoryRow,
                markType: field?.markType,
              });
            }
            rows.push(row);
          }

          nextGrids[sheetName] = rows;
        }

        setGrids(nextGrids);
        setSheetTabs(tabs);
        setFieldSheetById(sheetByField);
        setActiveSheet((prev) => (prev && tabs.includes(prev) ? prev : tabs[0] ?? ''));
      } catch (err) {
        console.error('Failed to load XLSX:', err);
        // Fallback: render fields as a flat label/value grid under a single tab.
        const fallbackName = doc.sourceSheetName ?? 'Fields';
        const fallback: CellData[][] = fields.map((f) => [
          { value: f.label, isEditable: false, isHeader: false, isCategoryRow: false },
          { value: f.value ?? '', isEditable: true, fieldId: f.fieldId, isHeader: false, isCategoryRow: false },
        ]);
        setGrids({ [fallbackName]: fallback });
        setSheetTabs([fallbackName]);
        setFieldSheetById(Object.fromEntries(fields.map((f) => [f.fieldId, fallbackName])));
        setActiveSheet(fallbackName);
      } finally {
        setLoading(false);
      }
    };

    loadXlsx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.sourceFileKey]);

  const handleCellChange = useCallback((sheetName: string, row: number, col: number, value: string) => {
    setIsDirty(true);
    setGrids((prev) => {
      const sheetGrid = prev[sheetName];
      if (!sheetGrid?.[row]) return prev;
      const updatedRows = [...sheetGrid];
      updatedRows[row] = [...updatedRows[row]];
      updatedRows[row][col] = { ...updatedRows[row][col], value };
      return { ...prev, [sheetName]: updatedRows };
    });
  }, []);

  const handleCellBlur = useCallback(() => {
    setEditingCell(null);
    setIsDirty(true);
  }, []);

  const handleTabChange = useCallback((sheetName: string) => {
    setEditingCell(null);
    setActiveSheet(sheetName);
  }, []);

  // Save all fields in one request (excluding deleted fields). Reads the latest
  // value from the sidebar first, then the sheet grid, then the original field.
  const handleSaveAll = useCallback(async () => {
    setIsSaving(true);
    try {
      const allGridCells = Object.values(grids).flat().flat();
      const allFields = fields
        .filter((f) => !deletedFieldIds.has(f.fieldId))
        .map((f) => {
          const gridCell = allGridCells.find((c) => c.fieldId === f.fieldId);
          const value = sidebarValues[f.fieldId] ?? gridCell?.value ?? f.value;
          // Mirror the cell value into markChar for CHECKBOX/CIRCLE so the
          // backend XLSX writer (which reads markChar) stays in sync with
          // what the user toggled in the editor.
          const markChar = (f.markType === 'CHECKBOX' || f.markType === 'CIRCLE')
            ? (value && value.length > 0 ? value : null)
            : f.markChar;
          return { ...f, value, markChar };
        });

      await apiMutate(buildApiUrl('/required-forms/save-fields', { orgId }), 'PUT', {
        projectId: doc.projectId, opportunityId: doc.opportunityId,
        formId: doc.formId, fields: allFields,
      });

      setIsDirty(false);
      setDeletedFieldIds(new Set()); // Clear after successful save
      toast({ title: 'Saved' });
      onFieldUpdated?.();
    } catch (err) {
      toast({ title: 'Save failed', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [fields, grids, sidebarValues, doc, orgId, toast, onFieldUpdated, deletedFieldIds]);

  // Reprocess
  const handleReprocess = useCallback(async () => {
    const ok = await confirm({ title: 'Reprocess form?', description: 'This will re-extract fields and re-fill. Manual edits will be lost.', confirmLabel: 'Reprocess', variant: 'destructive' });
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

  // Fields shown in the sidebar are scoped to the active sheet so the tab and
  // sidebar stay coherent. We reuse the fieldId → sheet resolution computed at
  // load time (against the real workbook) rather than re-deriving it from
  // sheetIndex here — sheetIndex points into the full workbook, not the filtered
  // tab list, so indexing sheetTabs[f.sheetIndex] would mis-assign fields.
  const activeSheetFields = fields.filter((f) => {
    if (deletedFieldIds.has(f.fieldId)) return false;
    if (sheetTabs.length <= 1) return true;
    return fieldSheetById[f.fieldId] === activeSheet;
  });

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
                  Export XLSX
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

      <div className={cn('flex flex-1 overflow-hidden relative', reprocessing && 'opacity-50 pointer-events-none')}>
        {/* Table — pinned to a light "paper" surface with dark text so it stays
            readable regardless of the app theme (the cells inherit their text
            color, which would otherwise pick up the dark-mode light foreground
            and wash out on white). */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white text-gray-900">
        {/* Sheet tabs — only rendered when the workbook has more than one data sheet */}
        {!loading && sheetTabs.length > 1 && (
          <div className="flex items-end gap-1 px-3 pt-2 border-b bg-gray-50/60 shrink-0 overflow-x-auto">
            {sheetTabs.map((name) => (
              <button
                key={name}
                onClick={() => handleTabChange(name)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-t-md border border-b-0 whitespace-nowrap',
                  name === activeSheet
                    ? 'bg-white font-semibold text-gray-900 border-gray-200'
                    : 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200/70',
                )}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : grid.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">No data found.</p>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <tbody>
              {grid.map((row, rowIdx) => (
                <tr key={rowIdx} className={cn(
                  row[0]?.isHeader && 'bg-gray-100 font-semibold text-[11px]',
                  row[0]?.isCategoryRow && 'bg-blue-50 font-semibold',
                )}>
                  {row.map((cell, colIdx) => {
                    const isEditing = editingCell?.row === rowIdx && editingCell?.col === colIdx;
                    const isMark = cell.markType === 'CHECKBOX' || cell.markType === 'CIRCLE';
                    const markChar = cell.markType === 'CIRCLE' ? '○' : 'X';
                    const isMarkSet = isMark && cell.value === markChar;

                    const handleMarkToggle = () => {
                      if (!cell.isEditable) return;
                      handleCellChange(activeSheet, rowIdx, colIdx, isMarkSet ? '' : markChar);
                    };

                    return (
                      <td
                        key={colIdx}
                        className={cn(
                          'border border-gray-200 px-2 py-1 align-top',
                          cell.isEditable && !isMark && !isEditing && 'cursor-text hover:bg-indigo-50/50',
                          cell.isEditable && isMark && 'cursor-pointer hover:bg-indigo-50/50 text-center',
                          // Filled editable cells get a subtle green wash; empty ones use a
                          // left-border accent instead of a fill so they don't blanket the
                          // whole matrix in a near-white tint (reads as an overlay).
                          cell.isEditable && cell.value && 'bg-green-50/40',
                          cell.isEditable && !cell.value && 'border-l-2 border-l-amber-300',
                          cell.isCategoryRow && 'bg-blue-50 font-semibold',
                        )}
                        onClick={() => {
                          if (!cell.isEditable || !canEdit) return;
                          if (isMark) handleMarkToggle();
                          else setEditingCell({ row: rowIdx, col: colIdx });
                        }}
                        title={isMark ? `Click to ${isMarkSet ? 'clear' : `mark "${markChar}"`}` : undefined}
                      >
                        {isMark ? (
                          <span className={cn('inline-block w-5 text-center font-semibold', isMarkSet ? 'text-rose-600' : 'text-gray-300')}>
                            {isMarkSet ? markChar : '·'}
                          </span>
                        ) : isEditing ? (
                          <input
                            type="text"
                            className="w-full bg-transparent outline-none text-[12px] border-b border-indigo-400"
                            value={cell.value}
                            onChange={(e) => handleCellChange(activeSheet, rowIdx, colIdx, e.target.value)}
                            onBlur={handleCellBlur}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleCellBlur(); }}
                            autoFocus
                          />
                        ) : (
                          <span className={cn(!cell.value && cell.isEditable && 'text-gray-300 italic text-[10px]')}>
                            {cell.value || (cell.isEditable ? 'click to edit' : '')}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        </div>
        </div>

        {/* Right: Field sidebar — same light-surface pinning as the grid. */}
        <div className="w-[300px] border-l flex flex-col overflow-hidden bg-white text-gray-900 shrink-0">
          <div className="px-4 py-3 border-b bg-gray-50/80 shrink-0">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-700">Fields</p>
              <p className="text-[10px] text-gray-500">{activeSheetFields.filter((f) => f.value).length}/{activeSheetFields.length} filled</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {activeSheetFields.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No editable fields detected.</p>
            ) : (
              activeSheetFields.map((field) => {
                const isEditingSidebar = editingSidebarField === field.fieldId;
                const sidebarVal = sidebarValues[field.fieldId] ?? field.value ?? '';
                return (
                  <div key={field.fieldId} className="px-4 py-2.5 border-b border-gray-100 group">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-medium text-gray-500 truncate">{field.label}</p>
                      {canEdit && (
                        <button
                          className="p-0.5 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100"
                          onClick={() => {
                            setDeletedFieldIds((prev) => new Set([...prev, field.fieldId]));
                            setIsDirty(true);
                            toast({ title: 'Field marked for deletion', description: 'Save the form to apply changes.' });
                          }}
                          title="Delete field"
                        >
                          <Trash2 className="h-3 w-3 text-red-400" />
                        </button>
                      )}
                    </div>
                    {isEditingSidebar && canEdit ? (
                      <input
                        className="w-full mt-0.5 text-xs border-b border-indigo-400 outline-none bg-transparent"
                        value={sidebarVal}
                        onChange={(e) => { setSidebarValues((prev) => ({ ...prev, [field.fieldId]: e.target.value })); setIsDirty(true); }}
                        onBlur={() => setEditingSidebarField(null)}
                        onKeyDown={(e) => { if (e.key === 'Enter') setEditingSidebarField(null); }}
                        autoFocus
                      />
                    ) : (
                      <p
                        className={cn('text-xs mt-0.5 truncate', canEdit && 'cursor-pointer', sidebarVal ? 'text-gray-900' : 'text-gray-300 italic')}
                        onClick={() => canEdit && setEditingSidebarField(field.fieldId)}
                      >
                        {sidebarVal || (canEdit ? 'click to edit' : '—')}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog />
    </div>
  );
};

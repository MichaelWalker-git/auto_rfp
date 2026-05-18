'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Download, RefreshCw, ArrowLeft, Trash2 } from 'lucide-react';
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
};

export const XlsxFormEditor = ({ doc, orgId, onFieldUpdated }: XlsxFormEditorProps) => {
  const { toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const fields = (doc.fields ?? []) as DetectedFormField[];
  const [grid, setGrid] = useState<CellData[][]>([]);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [editingSidebarField, setEditingSidebarField] = useState<string | null>(null);
  const [sidebarValues, setSidebarValues] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);

  const backUrl = `/organizations/${orgId}/projects/${doc.projectId}/opportunities/${doc.opportunityId}`;

  const fieldByCellRef = useMemo(() => {
    const map = new Map<string, DetectedFormField>();
    for (const f of fields) {
      if (f.cellReference) map.set(f.cellReference, f);
    }
    return map;
  }, [fields]);

  // Load the actual XLSX from S3 and render full grid
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

        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) throw new Error('No sheet found');

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
            const field = fieldByCellRef.get(cellRef);

            row.push({
              value: field?.value ?? cellValue,
              isEditable: !!field,
              fieldId: field?.fieldId,
              isHeader: isHeaderRow,
              isCategoryRow,
            });
          }
          rows.push(row);
        }

        setGrid(rows);
      } catch (err) {
        console.error('Failed to load XLSX:', err);
        const fallback: CellData[][] = fields.map((f) => [
          { value: f.label, isEditable: false, isHeader: false, isCategoryRow: false },
          { value: f.value ?? '', isEditable: true, fieldId: f.fieldId, isHeader: false, isCategoryRow: false },
        ]);
        setGrid(fallback);
      } finally {
        setLoading(false);
      }
    };

    loadXlsx();
  }, [doc.sourceFileKey]);

  const handleCellChange = useCallback((row: number, col: number, value: string) => {
    setIsDirty(true);
    setGrid((prev) => {
      const updated = [...prev];
      if (updated[row]) {
        updated[row] = [...updated[row]];
        updated[row][col] = { ...updated[row][col], value };
      }
      return updated;
    });
  }, []);

  const handleCellBlur = useCallback((_row: number, _col: number) => {
    setEditingCell(null);
    setIsDirty(true);
  }, []);

  // Save all fields in one request
  const handleSaveAll = useCallback(async () => {
    setIsSaving(true);
    try {
      const allFields = fields.map((f) => {
        const gridCell = grid.flat().find((c) => c.fieldId === f.fieldId);
        return { ...f, value: gridCell?.value ?? f.value };
      });

      await apiMutate(buildApiUrl('/required-forms/save-fields', { orgId }), 'PUT', {
        projectId: doc.projectId, opportunityId: doc.opportunityId,
        formId: doc.formId, fields: allFields,
      });

      setIsDirty(false);
      toast({ title: 'Saved' });
      onFieldUpdated?.();
    } catch (err) {
      toast({ title: 'Save failed', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [fields, grid, doc, orgId, toast, onFieldUpdated]);

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
      await apiFetcher(buildApiUrl('/required-forms/delete', { orgId, projectId: doc.projectId, opportunityId: doc.opportunityId, formId: doc.formId }));
      toast({ title: 'Form deleted' });
      window.location.href = backUrl;
    } catch (err) {
      toast({ title: 'Delete failed', description: (err as Error)?.message, variant: 'destructive' });
    }
  }, [doc, orgId, toast, backUrl, confirm]);

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
        <Button size="sm" variant="outline" onClick={handleReprocess} disabled={reprocessing} className="gap-1.5">
          <RefreshCw className={cn('h-3.5 w-3.5', reprocessing && 'animate-spin')} />
          Reprocess
        </Button>
        <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting} className="gap-1.5">
          {exporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export XLSX
        </Button>
        <Button size="sm" variant={isDirty ? 'default' : 'outline'} onClick={handleSaveAll} disabled={isSaving || !isDirty || reprocessing} className="gap-1.5">
          {isSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDeleteForm} className="text-red-500 hover:text-red-700 hover:bg-red-50">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className={cn('flex flex-1 overflow-hidden relative', reprocessing && 'opacity-50 pointer-events-none')}>
        {/* Table */}
        <div className="flex-1 overflow-auto bg-white">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
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
                    return (
                      <td
                        key={colIdx}
                        className={cn(
                          'border border-gray-200 px-2 py-1 align-top',
                          cell.isEditable && !isEditing && 'cursor-text hover:bg-indigo-50/50',
                          cell.isEditable && cell.value && 'bg-green-50/40',
                          cell.isEditable && !cell.value && 'bg-yellow-50/20',
                          cell.isCategoryRow && 'bg-blue-50 font-semibold',
                        )}
                        onClick={() => cell.isEditable && setEditingCell({ row: rowIdx, col: colIdx })}
                      >
                        {isEditing ? (
                          <input
                            type="text"
                            className="w-full bg-transparent outline-none text-[12px] border-b border-indigo-400"
                            value={cell.value}
                            onChange={(e) => handleCellChange(rowIdx, colIdx, e.target.value)}
                            onBlur={() => handleCellBlur(rowIdx, colIdx)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleCellBlur(rowIdx, colIdx); }}
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

        {/* Right: Field sidebar */}
        <div className="w-[300px] border-l flex flex-col overflow-hidden bg-white shrink-0">
          <div className="px-4 py-3 border-b bg-gray-50/80 shrink-0">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-700">Fields</p>
              <p className="text-[10px] text-gray-500">{fields.filter((f) => f.value).length}/{fields.length} filled</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {fields.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No editable fields detected.</p>
            ) : (
              fields.map((field) => {
                const isEditingSidebar = editingSidebarField === field.fieldId;
                const sidebarVal = sidebarValues[field.fieldId] ?? field.value ?? '';
                return (
                  <div key={field.fieldId} className="px-4 py-2.5 border-b border-gray-100 group">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-medium text-gray-500 truncate">{field.label}</p>
                      <button className="p-0.5 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100" onClick={() => { /* delete would need save-fields call */ setIsDirty(true); }}>
                        <Trash2 className="h-3 w-3 text-red-400" />
                      </button>
                    </div>
                    {isEditingSidebar ? (
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
                        className={cn('text-xs mt-0.5 truncate cursor-pointer', sidebarVal ? 'text-gray-900' : 'text-gray-300 italic')}
                        onClick={() => setEditingSidebarField(field.fieldId)}
                      >
                        {sidebarVal || 'click to edit'}
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

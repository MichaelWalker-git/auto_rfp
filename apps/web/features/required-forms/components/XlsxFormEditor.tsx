'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Download, RefreshCw, ArrowLeft } from 'lucide-react';
import { apiMutate, apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { DetectedFormField, RFPDocumentItem } from '@auto-rfp/core';
import { DocumentStatusBadge } from '@/components/rfp-documents/document-status-badge';

interface XlsxFormEditorProps {
  doc: RFPDocumentItem;
  orgId: string;
  onFieldUpdated?: () => void;
}

type CellData = {
  row: number;
  col: number;
  value: string;
  isHeader: boolean;
  isEditable: boolean;
  fieldId?: string;
  colSpan?: number;
};

export const XlsxFormEditor = ({ doc, orgId, onFieldUpdated }: XlsxFormEditorProps) => {
  const { toast } = useToast();
  const fields = (doc.formFields ?? []) as DetectedFormField[];
  const [cells, setCells] = useState<CellData[][]>([]);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);

  const backUrl = `/organizations/${orgId}/projects/${doc.projectId}/opportunities/${doc.opportunityId}`;

  // Parse fields into a table structure
  useEffect(() => {
    if (!fields.length) {
      setLoading(false);
      return;
    }

    // Fields with cellReference (like "B9", "C9") can be mapped to rows/cols
    // Fields without cellReference: render as a flat list
    const hasRefs = fields.some((f) => f.cellReference);

    if (hasRefs) {
      // Parse cell references into row/col grid
      const grid: Map<string, DetectedFormField> = new Map();
      let maxRow = 0;
      let maxCol = 0;

      for (const f of fields) {
        if (f.cellReference) {
          const match = f.cellReference.match(/^([A-Z]+)(\d+)$/);
          if (match) {
            const col = match[1].split('').reduce((acc, c) => acc * 26 + c.charCodeAt(0) - 64, 0) - 1;
            const row = parseInt(match[2], 10) - 1;
            grid.set(`${row}-${col}`, f);
            maxRow = Math.max(maxRow, row);
            maxCol = Math.max(maxCol, col);
          }
        }
      }

      const tableRows: CellData[][] = [];
      for (let r = 0; r <= maxRow; r++) {
        const row: CellData[] = [];
        for (let c = 0; c <= maxCol; c++) {
          const field = grid.get(`${r}-${c}`);
          row.push({
            row: r,
            col: c,
            value: field?.value ?? '',
            isHeader: r === 0,
            isEditable: !!field,
            fieldId: field?.fieldId,
          });
        }
        tableRows.push(row);
      }
      setCells(tableRows);
    } else {
      // No cell references — render as label/value pairs
      const tableRows: CellData[][] = fields.map((f, idx) => [
        { row: idx, col: 0, value: f.label, isHeader: false, isEditable: false },
        { row: idx, col: 1, value: f.value ?? '', isHeader: false, isEditable: true, fieldId: f.fieldId },
      ]);
      setCells(tableRows);
    }

    setLoading(false);
  }, [fields]);

  const handleCellChange = useCallback((row: number, col: number, value: string) => {
    setCells((prev) => {
      const updated = [...prev];
      if (updated[row]) {
        updated[row] = [...updated[row]];
        updated[row][col] = { ...updated[row][col], value };
      }
      return updated;
    });
  }, []);

  const handleCellBlur = useCallback(async (row: number, col: number) => {
    setEditingCell(null);
    const cell = cells[row]?.[col];
    if (!cell?.fieldId) return;

    try {
      await apiMutate(buildApiUrl('/required-forms/field', { orgId }), 'PUT', {
        projectId: doc.projectId, opportunityId: doc.opportunityId,
        documentId: doc.documentId, fieldId: cell.fieldId,
        value: cell.value || null, orgId,
      });
    } catch (err) {
      toast({ title: 'Save failed', description: (err as Error)?.message, variant: 'destructive' });
    }
  }, [cells, doc, orgId, toast]);

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

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-background shrink-0">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href={backUrl}><ArrowLeft className="h-4 w-4" />Back</Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{doc.name}</p>
          <p className="text-xs text-muted-foreground">{doc.originalFileName}</p>
        </div>
        <DocumentStatusBadge status={doc.status} />
        <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting} className="gap-1.5">
          {exporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export XLSX
        </Button>
      </div>

      {/* Table editor */}
      <div className="flex-1 overflow-auto p-4 bg-gray-50">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : cells.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">No spreadsheet data detected.</p>
        ) : (
          <div className="bg-white border rounded-lg shadow-sm overflow-auto">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {cells.map((row, rowIdx) => (
                  <tr key={rowIdx} className={cn(row[0]?.isHeader && 'bg-gray-100 font-medium')}>
                    {row.map((cell, colIdx) => {
                      const isEditing = editingCell?.row === rowIdx && editingCell?.col === colIdx;

                      return (
                        <td
                          key={colIdx}
                          colSpan={cell.colSpan}
                          className={cn(
                            'border border-gray-200 px-2 py-1.5 min-w-[80px] max-w-[300px]',
                            cell.isEditable && 'cursor-text hover:bg-blue-50/50',
                            cell.isEditable && cell.value && 'bg-green-50/30',
                            cell.isEditable && !cell.value && 'bg-yellow-50/30',
                            cell.isHeader && 'bg-gray-100 font-medium text-xs',
                          )}
                          onClick={() => cell.isEditable && setEditingCell({ row: rowIdx, col: colIdx })}
                        >
                          {isEditing ? (
                            <input
                              type="text"
                              className="w-full bg-transparent outline-none text-sm"
                              value={cell.value}
                              onChange={(e) => handleCellChange(rowIdx, colIdx, e.target.value)}
                              onBlur={() => handleCellBlur(rowIdx, colIdx)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleCellBlur(rowIdx, colIdx); }}
                              autoFocus
                            />
                          ) : (
                            <span className={cn('text-xs', !cell.value && cell.isEditable && 'text-gray-400 italic')}>
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
          </div>
        )}
      </div>
    </div>
  );
};

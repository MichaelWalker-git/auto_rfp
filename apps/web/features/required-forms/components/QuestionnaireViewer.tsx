'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import {
  parseHighlightCell,
  highlightCellByCoords,
  highlightFormSnippet,
  CELL_LOCATOR_ATTR,
} from '@/features/compliance-review';

type CellData = {
  value: string;
  isEditable: boolean;
  isHeader: boolean;
  isCategoryRow: boolean;
  colSpan?: number;
  rowSpan?: number;
  isMerged?: boolean;
};

interface QuestionnaireEditorProps {
  fileKey: string;
  fileName?: string;
  answerColumn?: string;
  firstDataRow?: number;
  onDirtyChange?: (isDirty: boolean) => void;
  onWorkbookReady?: (getBuffer: () => Promise<ArrayBuffer | null>) => void;
}

export const QuestionnaireEditor = ({
  fileKey,
  fileName,
  answerColumn,
  firstDataRow,
  onDirtyChange,
  onWorkbookReady,
}: QuestionnaireEditorProps) => {
  const [grid, setGrid] = useState<CellData[][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [workbookRef, setWorkbookRef] = useState<XLSX.WorkBook | null>(null);
  const [sheetName, setSheetName] = useState<string>('');
  // SheetJS row index of grid row 0 (the used range's start row). The compliance
  // cell inventory uses ABSOLUTE SheetJS coordinates, so a `data-highlight-cell`
  // attribute must add this base back to the grid index to match an anchor.
  const [baseRow, setBaseRow] = useState<number>(0);
  const originalBufferRef = useRef<ArrayBuffer | null>(null);
  const [colWidths, setColWidths] = useState<number[]>([]);
  const [rowHeights, setRowHeights] = useState<number[]>([]);

  const answerColIndex = answerColumn
    ? (() => {
        let idx = 0;
        for (let i = 0; i < answerColumn.length; i++) {
          idx = idx * 26 + (answerColumn.toUpperCase().charCodeAt(i) - 64);
        }
        return idx - 1;
      })()
    : -1;

  useEffect(() => {
    const loadXlsx = async () => {
      setLoading(true);
      setError(null);
      try {
        const presignResult = await apiMutate<{ url: string }>(
          buildApiUrl('/presigned/generate-presigned-url'),
          'POST',
          { operation: 'download', key: fileKey },
        );
        if (!presignResult?.url) throw new Error('Failed to get file URL');

        const response = await fetch(presignResult.url);
        const arrayBuffer = await response.arrayBuffer();
        originalBufferRef.current = arrayBuffer;

        // Load with xlsx for grid parsing (better API for reading cell data)
        const workbook = XLSX.read(arrayBuffer, { type: 'array', cellStyles: true });

        const wsName = workbook.SheetNames[0]!;
        setSheetName(wsName);
        setWorkbookRef(workbook);

        const sheet = workbook.Sheets[wsName];
        if (!sheet) throw new Error('No sheet found');

        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
        setBaseRow(range.s.r);
        const merges = sheet['!merges'] ?? [];

        // Build merge map: for each cell, know if it's the start of a merge or hidden by a merge
        const mergeStarts = new Map<string, { colSpan: number; rowSpan: number }>();
        const mergedCells = new Set<string>();

        for (const m of merges) {
          const startKey = `${m.s.r},${m.s.c}`;
          mergeStarts.set(startKey, {
            colSpan: m.e.c - m.s.c + 1,
            rowSpan: m.e.r - m.s.r + 1,
          });
          for (let r = m.s.r; r <= m.e.r; r++) {
            for (let c = m.s.c; c <= m.e.c; c++) {
              if (r !== m.s.r || c !== m.s.c) {
                mergedCells.add(`${r},${c}`);
              }
            }
          }
        }

        const maxCols = range.e.c + 1;

        // Extract column widths from sheet metadata
        const colWidths: number[] = [];
        const sheetCols = sheet['!cols'] ?? [];
        for (let c = 0; c < maxCols; c++) {
          const col = sheetCols[c];
          if (col?.wpx) colWidths.push(col.wpx);
          else if (col?.wch) colWidths.push(col.wch * 7);
          else colWidths.push(120);
        }

        // Extract row heights from sheet metadata
        const rowHeightsArr: number[] = [];
        const sheetRows = sheet['!rows'] ?? [];
        for (let r = range.s.r; r <= range.e.r; r++) {
          const row = sheetRows[r];
          if (row?.hpx) rowHeightsArr.push(row.hpx);
          else if (row?.hpt) rowHeightsArr.push(row.hpt * 1.33);
          else rowHeightsArr.push(24);
        }

        setColWidths(colWidths);
        setRowHeights(rowHeightsArr);

        const rows: CellData[][] = [];

        for (let r = range.s.r; r <= range.e.r; r++) {
          const row: CellData[] = [];
          const isHeaderRow = firstDataRow ? r < firstDataRow - 1 : false;

          for (let c = 0; c < maxCols; c++) {
            const cellKey = `${r},${c}`;

            if (mergedCells.has(cellKey)) {
              row.push({ value: '', isEditable: false, isHeader: false, isCategoryRow: false, isMerged: true });
              continue;
            }

            const addr = XLSX.utils.encode_cell({ r, c });
            const cell = sheet[addr];
            let cellValue = '';
            if (cell) {
              const raw = cell.w !== undefined ? cell.w : cell.v;
              if (typeof raw === 'string') cellValue = raw;
              else if (typeof raw === 'number' || typeof raw === 'boolean') cellValue = String(raw);
            }

            const merge = mergeStarts.get(cellKey);
            const isAnswerCol = answerColIndex >= 0 && c === answerColIndex;
            const isDataRow = firstDataRow ? r >= firstDataRow - 1 : !isHeaderRow;

            // Detect section/category rows: merged across most columns with text
            const isCategoryRow = !!(merge && merge.colSpan >= maxCols - 1 && cellValue.trim());

            const editable = answerColIndex < 0
              ? true
              : (isAnswerCol && isDataRow && !isCategoryRow);

            row.push({
              value: cellValue,
              isEditable: editable,
              isHeader: isHeaderRow,
              isCategoryRow,
              colSpan: merge?.colSpan,
              rowSpan: merge?.rowSpan,
            });
          }
          rows.push(row);
        }

        setGrid(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load spreadsheet');
      } finally {
        setLoading(false);
      }
    };

    void loadXlsx();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey]);

  useEffect(() => {
    if (!onWorkbookReady) return;

    const getBuffer = async (): Promise<ArrayBuffer | null> => {
      const originalBuffer = originalBufferRef.current;
      if (!originalBuffer) return null;

      // Dynamically import exceljs (preserves all styles on write)
      const ExcelJSModule = await import('exceljs');
      const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
      const ejsWb = new ExcelJS.Workbook();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ejsWb.xlsx.load(originalBuffer as any);

      const ejsSheet = ejsWb.getWorksheet(sheetName || ejsWb.worksheets[0]?.name || '');
      if (!ejsSheet) return null;

      // Apply edited cell values
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r]!;
        for (let c = 0; c < row.length; c++) {
          const cell = row[c];
          if (!cell || cell.isMerged) continue;
          const ejsCell = ejsSheet.getRow(r + 1).getCell(c + 1);
          const originalValue = ejsCell.value != null ? String(ejsCell.value) : '';
          if (cell.value !== originalValue) {
            ejsCell.value = cell.value || null;
          }
        }
      }

      const buffer = await ejsWb.xlsx.writeBuffer();
      return buffer as ArrayBuffer;
    };

    onWorkbookReady(getBuffer);
  }, [grid, sheetName, onWorkbookReady]);

  // Compliance-review deep-link: when opened with ?highlightCell / ?findSnippet,
  // scroll to + flash the referenced cell. DOM-only (never persisted) so export
  // is unaffected. The viewer renders only the first sheet, so a cell anchor for
  // another sheet falls back to snippet search.
  //
  // We POLL rather than flash on a single fixed delay: this grid can be hundreds
  // of rows, so the cell's <td> may not be painted yet when the effect first runs
  // (setLoading(false)/setGrid/setSheetName can commit before the heavy grid is
  // laid out). A one-shot timeout that fires early finds nothing and — with the
  // ref already set — never retries. Polling re-tries until the target node
  // exists, mirroring the HTML editor's highlightFromParams.
  const searchParams = useSearchParams();
  const highlightCellParam = searchParams?.get('highlightCell') ?? null;
  const findSnippet = searchParams?.get('findSnippet') ?? null;
  const hasHighlightedRef = useRef(false);
  useEffect(() => {
    if (loading || hasHighlightedRef.current) return;
    if (!highlightCellParam && !findSnippet) return;

    const cell = parseHighlightCell(highlightCellParam);
    const onThisSheet = !!cell && cell.sheet.trim().toLowerCase() === sheetName.trim().toLowerCase();

    let attempts = 0;
    const MAX_ATTEMPTS = 40; // ~6s of settling headroom (150ms × 40)
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tryHighlight = () => {
      attempts += 1;
      // Prefer the exact cell; fall back to snippet search over the grid.
      if (onThisSheet && highlightCellByCoords(cell!.row, cell!.col)) {
        hasHighlightedRef.current = true;
        return;
      }
      if (findSnippet && highlightFormSnippet(findSnippet)) {
        hasHighlightedRef.current = true;
        return;
      }
      if (attempts < MAX_ATTEMPTS) {
        timer = setTimeout(tryHighlight, 150);
      } else {
        // Give up quietly — nothing to point at (e.g. cell on a non-rendered
        // sheet and the snippet isn't in the visible grid).
        hasHighlightedRef.current = true;
      }
    };

    // First attempt on the next tick so the initial grid paint has a chance.
    timer = setTimeout(tryHighlight, 150);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [loading, highlightCellParam, findSnippet, sheetName]);

  const handleCellChange = useCallback((row: number, col: number, value: string) => {
    setGrid((prev) => {
      const updated = [...prev];
      if (updated[row]) {
        updated[row] = [...updated[row]!];
        updated[row]![col] = { ...updated[row]![col]!, value };
      }
      return updated;
    });
    onDirtyChange?.(true);
  }, [onDirtyChange]);

  // Column resize — drag right border of any cell in the row-number column header area
  const resizingCol = useRef<{ col: number; startX: number; startWidth: number } | null>(null);

  const handleColResizeStart = (col: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[col] ?? 120;
    resizingCol.current = { col, startX, startWidth };

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      setColWidths((prev) => {
        const next = [...prev];
        next[col] = Math.max(30, startWidth + delta);
        return next;
      });
    };

    const onUp = () => {
      resizingCol.current = null;
      onDirtyChange?.(true);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Row resize — drag bottom border of row number cell
  const resizingRow = useRef<{ row: number; startY: number; startHeight: number } | null>(null);

  const handleRowResizeStart = (row: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startHeight = rowHeights[row] ?? 24;
    resizingRow.current = { row, startY, startHeight };

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY;
      setRowHeights((prev) => {
        const next = [...prev];
        next[row] = Math.max(16, startHeight + delta);
        return next;
      });
    };

    const onUp = () => {
      resizingRow.current = null;
      onDirtyChange?.(true);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (loading) {
    return <Skeleton className="w-full h-[600px]" />;
  }

  return (
    <div className="w-full h-full overflow-auto">
      <table className="border-collapse text-xs" style={{ tableLayout: 'fixed', width: colWidths.reduce((sum, w) => sum + w, 40) }}>
        <colgroup>
          <col style={{ width: 40 }} />
          {colWidths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <tbody>
          {grid.map((row, rowIdx) => (
            <tr
              key={rowIdx}
              style={{ height: rowHeights[rowIdx] ?? 24 }}
              className={cn(
                row.some((c) => c.isHeader) && 'bg-slate-700 text-white font-semibold',
                row.some((c) => c.isCategoryRow) && 'bg-slate-600 text-white font-medium',
              )}
            >
              <td className="relative px-1 py-0.5 border border-border/40 text-muted-foreground text-center text-[10px] bg-muted/40 select-none">
                {rowIdx + 1}
                <div
                  className="absolute bottom-0 left-0 w-full h-1.5 cursor-row-resize hover:bg-primary/40 z-20"
                  onMouseDown={(e) => handleRowResizeStart(rowIdx, e)}
                />
              </td>
              {row.map((cell, colIdx) => {
                if (cell.isMerged) return null;

                const isEditing = editingCell?.row === rowIdx && editingCell?.col === colIdx;

                return (
                  <td
                    key={colIdx}
                    colSpan={cell.colSpan}
                    rowSpan={cell.rowSpan}
                    style={{ maxHeight: rowHeights[rowIdx] ?? 24 }}
                    // Absolute SheetJS coords so a compliance-review `cell` anchor
                    // ({sheet,row,col}) resolves to the same node the backend
                    // inventoried. col is already absolute; row adds the base.
                    {...{ [CELL_LOCATOR_ATTR]: `${baseRow + rowIdx},${colIdx}` }}
                    className={cn(
                      'relative px-2 py-1 border border-border/40 overflow-hidden align-top cursor-cell',
                      isEditing && 'ring-2 ring-primary ring-inset',
                      cell.isCategoryRow && 'font-semibold',
                    )}
                    onClick={() => setEditingCell({ row: rowIdx, col: colIdx })}
                  >
                    {/* Column resize handle on right border */}
                    {!cell.colSpan && (
                      <div
                        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/50 z-10"
                        onMouseDown={(e) => handleColResizeStart(colIdx, e)}
                      />
                    )}
                    {isEditing ? (
                      <textarea
                        className="w-full min-h-[60px] bg-transparent border-none outline-none resize-y text-xs p-0"
                        value={cell.value}
                        onChange={(e) => handleCellChange(rowIdx, colIdx, e.target.value)}
                        onBlur={() => setEditingCell(null)}
                        autoFocus
                      />
                    ) : (
                      <span className="block overflow-hidden break-words" style={{ maxHeight: (rowHeights[rowIdx] ?? 24) - 8 }}>{typeof cell.value === 'string' ? cell.value : String(cell.value ?? '')}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export { QuestionnaireEditor as QuestionnaireViewer };

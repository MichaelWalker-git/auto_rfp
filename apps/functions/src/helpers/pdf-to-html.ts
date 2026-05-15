import {
  TextractClient,
  AnalyzeDocumentCommand,
  type Block,
} from '@aws-sdk/client-textract';
import { requireEnv } from './env';

const textract = new TextractClient({});
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

type StructuredBlock = {
  type: 'TITLE' | 'SECTION_HEADER' | 'TEXT' | 'KEY_VALUE' | 'TABLE' | 'LIST' | 'FOOTER' | 'PAGE_NUMBER';
  content: string;
  children?: StructuredBlock[];
  rows?: string[][];
};

const getBlockText = (block: Block, blockMap: Map<string, Block>): string => {
  if (block.Text) return block.Text;
  if (!block.Relationships) return '';
  const texts: string[] = [];
  for (const rel of block.Relationships) {
    if (rel.Type === 'CHILD' && rel.Ids) {
      for (const id of rel.Ids) {
        const child = blockMap.get(id);
        if (child?.BlockType === 'WORD' && child.Text) texts.push(child.Text);
        if (child?.BlockType === 'SELECTION_ELEMENT') {
          texts.push(child.SelectionStatus === 'SELECTED' ? '(X)' : '( )');
        }
        if (child?.BlockType === 'LINE' && child.Text) texts.push(child.Text);
      }
    }
  }
  return texts.join(' ');
};

const buildTableRows = (table: Block, blockMap: Map<string, Block>): string[][] => {
  if (!table.Relationships) return [];
  const cellIds = table.Relationships.flatMap((r) => r.Type === 'CHILD' ? (r.Ids ?? []) : []);
  const cells = cellIds.map((id) => blockMap.get(id)).filter((c): c is Block => !!c && c.BlockType === 'CELL');
  if (cells.length === 0) return [];

  const maxRow = Math.max(...cells.map((c) => c.RowIndex ?? 0));
  const maxCol = Math.max(...cells.map((c) => c.ColumnIndex ?? 0));
  const rows: string[][] = Array.from({ length: maxRow }, () => Array(maxCol).fill(''));

  for (const cell of cells) {
    const r = (cell.RowIndex ?? 1) - 1;
    const c = (cell.ColumnIndex ?? 1) - 1;
    rows[r][c] = getBlockText(cell, blockMap);
  }

  return rows;
};

export const extractPdfStructure = async (fileKey: string): Promise<StructuredBlock[]> => {
  const bucket = getDocumentsBucket();

  const response = await textract.send(
    new AnalyzeDocumentCommand({
      Document: { S3Object: { Bucket: bucket, Name: fileKey } },
      FeatureTypes: ['FORMS', 'TABLES', 'LAYOUT'],
    }),
  );

  const blocks = response.Blocks ?? [];
  const blockMap = new Map<string, Block>();
  for (const b of blocks) {
    if (b.Id) blockMap.set(b.Id, b);
  }

  const result: StructuredBlock[] = [];

  // Process LAYOUT blocks first — they represent the document's visual structure
  const layoutBlocks = blocks.filter((b) =>
    b.BlockType?.startsWith('LAYOUT_'),
  );

  if (layoutBlocks.length > 0) {
    for (const lb of layoutBlocks) {
      const text = getBlockText(lb, blockMap);
      if (!text.trim()) continue;

      const typeMap: Record<string, StructuredBlock['type']> = {
        LAYOUT_TITLE: 'TITLE',
        LAYOUT_SECTION_HEADER: 'SECTION_HEADER',
        LAYOUT_KEY_VALUE: 'KEY_VALUE',
        LAYOUT_TABLE: 'TABLE',
        LAYOUT_LIST: 'LIST',
        LAYOUT_FOOTER: 'FOOTER',
        LAYOUT_PAGE_NUMBER: 'PAGE_NUMBER',
        LAYOUT_TEXT: 'TEXT',
        LAYOUT_HEADER: 'TEXT',
        LAYOUT_FIGURE: 'TEXT',
      };

      const type = typeMap[lb.BlockType ?? ''] ?? 'TEXT';

      if (type === 'PAGE_NUMBER' || type === 'FOOTER') continue;

      result.push({ type, content: text.trim() });
    }
  }

  // Process TABLE blocks — add structured row data
  const tableBlocks = blocks.filter((b) => b.BlockType === 'TABLE');
  for (const table of tableBlocks) {
    const rows = buildTableRows(table, blockMap);
    if (rows.length > 0) {
      result.push({ type: 'TABLE', content: '', rows });
    }
  }

  // Fallback: if no LAYOUT blocks found, use LINE blocks
  if (result.length < 3) {
    const lines = blocks.filter((b) => b.BlockType === 'LINE' && b.Text?.trim());
    for (const line of lines) {
      result.push({ type: 'TEXT', content: line.Text ?? '' });
    }
  }

  return result;
};

export const structureToJson = (blocks: StructuredBlock[]): string => {
  return JSON.stringify(blocks, null, 2);
};

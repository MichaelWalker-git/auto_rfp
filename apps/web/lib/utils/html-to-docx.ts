/**
 * Client-side HTML → DOCX conversion using the `docx` library.
 *
 * Parses the TipTap-generated HTML into Word paragraphs and produces a
 * downloadable .docx Blob — no Lambda required.
 *
 * Supports: headings (h1–h6), paragraphs, bold/italic/underline/strike inline marks,
 * bullet & ordered lists, tables, blockquotes, horizontal rules, and images.
 *
 * Image handling:
 * - `src="s3key:KEY"` placeholders are resolved to presigned URLs via the provided resolver
 * - `data-s3-key="KEY"` attributes are also resolved
 * - Regular https:// URLs are fetched directly
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from 'docx';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

type DocxChild = Paragraph | Table;

/** Callback to resolve an S3 key to a presigned download URL */
export type S3KeyResolver = (key: string) => Promise<string>;

// ─── Inline node → TextRun(s) ─────────────────────────────────────────────────

const parseInlineNodes = (node: Node, style: InlineStyle = {}): TextRun[] => {
  const runs: TextRun[] = [];

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (text) {
      runs.push(
        new TextRun({
          text,
          bold: style.bold,
          italics: style.italic,
          underline: style.underline ? {} : undefined,
          strike: style.strike,
        }),
      );
    }
    return runs;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return runs;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  const childStyle: InlineStyle = {
    bold: style.bold || tag === 'strong' || tag === 'b',
    italic: style.italic || tag === 'em' || tag === 'i',
    underline: style.underline || tag === 'u',
    strike: style.strike || tag === 's' || tag === 'del' || tag === 'strike',
  };

  if (tag === 'br') {
    runs.push(new TextRun({ text: '', break: 1 }));
    return runs;
  }

  for (const child of Array.from(el.childNodes)) {
    runs.push(...parseInlineNodes(child, childStyle));
  }

  return runs;
};

// ─── Image fetcher ────────────────────────────────────────────────────────────

const fetchImageAsBase64 = async (
  src: string,
  resolveS3Key?: S3KeyResolver,
): Promise<{ data: string; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null> => {
  try {
    let resolvedSrc = src;

    // Resolve s3key: placeholder to presigned URL
    if (src.startsWith('s3key:') && resolveS3Key) {
      const key = src.slice(6);
      try {
        resolvedSrc = await resolveS3Key(key);
      } catch {
        console.warn(`[html-to-docx] Failed to resolve s3key: ${key}`);
        return null;
      }
    }

    const res = await fetch(resolvedSrc);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mimeType = blob.type || 'image/png';

    // SVG is not supported by docx ImageRun without a fallback PNG — skip SVGs
    if (mimeType === 'image/svg+xml') return null;

    const typeMap: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/bmp': 'bmp',
    };
    const type = typeMap[mimeType] ?? 'png';

    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return { data: btoa(binary), type };
  } catch {
    return null;
  }
};

// ─── Block node → DocxChild[] ─────────────────────────────────────────────────

const parseBlockNode = async (el: Element, resolveS3Key?: S3KeyResolver): Promise<DocxChild[]> => {
  const tag = el.tagName.toLowerCase();

  // ── Headings ──
  const headingMap: Record<string, HeadingLevel> = {
    h1: HeadingLevel.HEADING_1,
    h2: HeadingLevel.HEADING_2,
    h3: HeadingLevel.HEADING_3,
    h4: HeadingLevel.HEADING_4,
    h5: HeadingLevel.HEADING_5,
    h6: HeadingLevel.HEADING_6,
  };
  if (headingMap[tag]) {
    return [
      new Paragraph({
        heading: headingMap[tag],
        children: parseInlineNodes(el),
        spacing: { before: convertInchesToTwip(0.15), after: convertInchesToTwip(0.05) },
      }),
    ];
  }

  // ── Paragraph ──
  if (tag === 'p') {
    const children = parseInlineNodes(el);
    if (!children.length) {
      return [new Paragraph({ children: [new TextRun('')] })];
    }
    const alignAttr = (el as HTMLElement).style.textAlign;
    const alignMap: Record<string, AlignmentType> = {
      center: AlignmentType.CENTER,
      right: AlignmentType.RIGHT,
      justify: AlignmentType.JUSTIFIED,
      left: AlignmentType.LEFT,
    };
    return [
      new Paragraph({
        children,
        alignment: alignMap[alignAttr] ?? AlignmentType.LEFT,
        spacing: { after: convertInchesToTwip(0.08) },
      }),
    ];
  }

  // ── Blockquote ──
  if (tag === 'blockquote') {
    const children = parseInlineNodes(el);
    return [
      new Paragraph({
        children,
        indent: { left: convertInchesToTwip(0.5) },
        spacing: { after: convertInchesToTwip(0.08) },
        border: {
          left: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB', space: 8 },
        },
      }),
    ];
  }

  // ── Horizontal rule ──
  if (tag === 'hr') {
    return [
      new Paragraph({
        children: [],
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E5E7EB', space: 1 },
        },
        spacing: { before: convertInchesToTwip(0.1), after: convertInchesToTwip(0.1) },
      }),
    ];
  }

  // ── Unordered list ──
  if (tag === 'ul') {
    const items: DocxChild[] = [];
    for (const li of Array.from(el.querySelectorAll(':scope > li'))) {
      items.push(
        new Paragraph({
          children: parseInlineNodes(li),
          bullet: { level: 0 },
          spacing: { after: convertInchesToTwip(0.04) },
        }),
      );
    }
    return items;
  }

  // ── Ordered list ──
  if (tag === 'ol') {
    const items: DocxChild[] = [];
    for (const li of Array.from(el.querySelectorAll(':scope > li'))) {
      items.push(
        new Paragraph({
          children: parseInlineNodes(li),
          numbering: { reference: 'default-numbering', level: 0 },
          spacing: { after: convertInchesToTwip(0.04) },
        }),
      );
    }
    return items;
  }

  // ── Image ──
  if (tag === 'img') {
    const imgEl = el as HTMLImageElement;

    // Prefer data-s3-key attribute (TipTap stores the key here)
    const s3Key = imgEl.getAttribute('data-s3-key');
    let src = s3Key ? `s3key:${s3Key}` : (imgEl.getAttribute('src') || '');

    // Also handle src="s3key:KEY" format directly
    if (!src || src === 's3key:') return [];

    const imageData = await fetchImageAsBase64(src, resolveS3Key);
    if (!imageData) return [];

    const widthPx = imgEl.naturalWidth || imgEl.width || 400;
    // Convert px to EMU (English Metric Units): 1 inch = 914400 EMU, 96 DPI
    const maxWidthEmu = 5486400; // ~6 inches
    const widthEmu = Math.min(Math.round((widthPx / 96) * 914400), maxWidthEmu);
    const heightPx = imgEl.naturalHeight || imgEl.height || 300;
    const aspectRatio = heightPx / Math.max(widthPx, 1);
    const heightEmu = Math.round(widthEmu * aspectRatio);

    return [
      new Paragraph({
        children: [
          new ImageRun({
            data: imageData.data,
            transformation: { width: Math.round(widthEmu / 9144), height: Math.round(heightEmu / 9144) },
            type: imageData.type,
          }),
        ],
        spacing: { after: convertInchesToTwip(0.08) },
      }),
    ];
  }

  // ── Table ──
  if (tag === 'table') {
    const rows: TableRow[] = [];
    let colCount = 1;
    const trEls = Array.from(el.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tr'));

    for (const tr of trEls) {
      const cells: TableCell[] = [];
      const tdEls = Array.from(tr.querySelectorAll(':scope > td, :scope > th'));
      colCount = Math.max(colCount, tdEls.length);

      for (const td of tdEls) {
        const isHeader = td.tagName.toLowerCase() === 'th';

        // Check if cell contains an image
        const imgEl = td.querySelector('img');
        let cellChildren: Paragraph[];

        if (imgEl) {
          // Cell contains an image — fetch and embed it
          const s3Key = imgEl.getAttribute('data-s3-key');
          const rawSrc = s3Key ? `s3key:${s3Key}` : (imgEl.getAttribute('src') || '');
          const imageData = rawSrc ? await fetchImageAsBase64(rawSrc, resolveS3Key) : null;

          if (imageData) {
            const widthPx = imgEl.naturalWidth || imgEl.width || 100;
            const heightPx = imgEl.naturalHeight || imgEl.height || 100;
            const maxW = 1440000; // ~1.5 inches in EMU
            const widthEmu = Math.min(Math.round((widthPx / 96) * 914400), maxW);
            const heightEmu = Math.round(widthEmu * (heightPx / Math.max(widthPx, 1)));
            cellChildren = [
              new Paragraph({
                children: [
                  new ImageRun({
                    data: imageData.data,
                    transformation: {
                      width: Math.max(1, Math.round(widthEmu / 9144)),
                      height: Math.max(1, Math.round(heightEmu / 9144)),
                    },
                    type: imageData.type,
                  }),
                ],
                spacing: { after: 0 },
              }),
            ];
          } else {
            // Image failed to load — empty cell
            cellChildren = [new Paragraph({ children: [new TextRun('')], spacing: { after: 0 } })];
          }
        } else {
          // Plain text / inline content
          cellChildren = [
            new Paragraph({
              children: parseInlineNodes(td, { bold: isHeader }),
              spacing: { after: 0 },
            }),
          ];
        }

        cells.push(
          new TableCell({
            children: cellChildren,
            shading: isHeader ? { fill: 'F9FAFB' } : undefined,
          }),
        );
      }

      if (cells.length) {
        rows.push(new TableRow({ children: cells }));
      }
    }

    if (!rows.length) return [];

    return [
      new Table({
        rows,
        // 9360 DXA = 6.5 inches (letter page width minus 1-inch margins each side)
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: Array(colCount).fill(Math.floor(9360 / colCount)),
      }),
    ];
  }

  // ── Div / section / article — recurse into children ──
  if (['div', 'section', 'article', 'main', 'aside'].includes(tag)) {
    const children: DocxChild[] = [];
    for (const child of Array.from(el.children)) {
      children.push(...(await parseBlockNode(child, resolveS3Key)));
    }
    return children;
  }

  // ── Fallback: treat as paragraph ──
  const text = el.textContent?.trim() ?? '';
  if (!text) return [];
  return [
    new Paragraph({
      children: [new TextRun({ text })],
      spacing: { after: convertInchesToTwip(0.08) },
    }),
  ];
};

// ─── Main export ──────────────────────────────────────────────────────────────

export interface HtmlToDocxOptions {
  /**
   * Resolver for S3 image keys.
   * Called with the raw S3 key (e.g. "org123/editor-images/photo.png")
   * and should return a presigned download URL.
   * If not provided, images with s3key: src will be skipped.
   */
  resolveS3Key?: S3KeyResolver;
}

/**
 * Convert an HTML string (as produced by the TipTap editor) into a DOCX Blob
 * that can be downloaded directly in the browser.
 *
 * The output contains only the HTML content — no extra title/date/customer headers.
 * Images stored in S3 (referenced via `data-s3-key` or `src="s3key:KEY"`) are
 * resolved to presigned URLs using the provided `resolveS3Key` callback and
 * embedded as base64 in the DOCX.
 *
 * @param html    Raw HTML body content from the editor
 * @param options Optional S3 key resolver
 */
export const htmlToDocxBlob = async (html: string, options: HtmlToDocxOptions = {}): Promise<Blob> => {
  const { resolveS3Key } = options;

  // Parse HTML in a detached DOM so we can traverse it
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
  const body = doc.body;

  const children: DocxChild[] = [];

  for (const child of Array.from(body.children)) {
    children.push(...(await parseBlockNode(child, resolveS3Key)));
  }

  // Ensure at least one paragraph
  if (!children.length) {
    children.push(new Paragraph({ children: [new TextRun('')] }));
  }

  const wordDoc = new Document({
    numbering: {
      config: [
        {
          reference: 'default-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(wordDoc);
};

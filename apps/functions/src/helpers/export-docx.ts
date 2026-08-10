/**
 * Server-side HTML → DOCX conversion using the native `docx` library.
 *
 * Parses TipTap editor HTML into proper OOXML elements (headings, paragraphs,
 * lists, tables, blockquotes, images, page breaks) and produces a well-formatted
 * Word document with professional styling.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  SectionType,
  ShadingType,
  Tab,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from 'docx';
import { resolveFurnitureVisibility, type PageFurniture, type TemplateFurniture } from '@auto-rfp/core';
import type { BuildExportHtmlOptions } from './export-html-builder';
import {
  hasSectionOverrides,
  inlineFurnitureImages,
  marginForFurniture,
  splitIntoFurnitureSections,
  TWIPS_PER_INCH,
} from './export-furniture';
// Note: extractHeadingsFromHtml, extractTocTitle, estimateHeadingPages, findTocPlaceholderInHtml
// are no longer needed — DOCX now receives pre-expanded TOC HTML (same as PDF/HTML path).

export interface HtmlToDocxOptions extends BuildExportHtmlOptions {
  /** Document creator metadata */
  creator?: string;
  /** Document description metadata */
  description?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Colors used throughout the document */
const COLORS = {
  heading1: '111827',
  heading2: '1F2937',
  heading3: '1F2937',
  heading4: '374151',
  body: '374151',
  muted: '6B7280',
  tableHeaderBg: 'F3F4F6',
  tableBorder: 'D1D5DB',
  blockquoteBorder: 'D1D5DB',
  link: '4F46E5',
} as const;

/** Font sizes in half-points (1pt = 2 half-points) */
const FONT_SIZES = {
  heading1: 40, // 20pt
  heading2: 32, // 16pt
  heading3: 26, // 13pt
  heading4: 22, // 11pt
  body: 22,     // 11pt
  small: 20,    // 10pt
} as const;

const FONT_FAMILY = 'Calibri';

/** Max image width in pixels for the content area (6.5 inches at 96 DPI) */
const MAX_IMAGE_WIDTH = 624;
/** Default image width when not specified */
const DEFAULT_IMAGE_WIDTH = 400;
/** Default image height when not specified */
const DEFAULT_IMAGE_HEIGHT = 300;

// ─── Types ────────────────────────────────────────────────────────────────────

type DocxChild = Paragraph | Table;

// ─── Image Helpers ────────────────────────────────────────────────────────────

/** Map file extension to docx ImageRun type */
const extToImageType = (ext: string): 'png' | 'jpg' | 'gif' | 'bmp' => {
  const map: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = {
    png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'gif', bmp: 'bmp',
  };
  return map[ext] ?? 'png';
};

/** Infer image type from URL or content-type header */
const inferImageType = (url: string, contentType?: string): 'png' | 'jpg' | 'gif' | 'bmp' => {
  if (contentType) {
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('gif')) return 'gif';
    if (contentType.includes('bmp')) return 'bmp';
  }
  const ext = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  return extToImageType(ext);
};

/**
 * Read image dimensions from raw buffer data by parsing file headers.
 * Supports PNG, JPEG, GIF, and BMP formats.
 * Returns null if dimensions cannot be determined.
 */
const getImageDimensions = (data: Buffer): { width: number; height: number } | null => {
  try {
    // PNG: bytes 16-23 contain width (4 bytes) and height (4 bytes) in IHDR chunk
    if (data.length > 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
      const width = data.readUInt32BE(16);
      const height = data.readUInt32BE(20);
      if (width > 0 && height > 0 && width < 20000 && height < 20000) {
        return { width, height };
      }
    }

    // JPEG: scan for SOF0/SOF2 markers (0xFF 0xC0 or 0xFF 0xC2)
    if (data.length > 2 && data[0] === 0xFF && data[1] === 0xD8) {
      let offset = 2;
      while (offset < data.length - 10) {
        if (data[offset] !== 0xFF) { offset++; continue; }
        const marker = data[offset + 1];
        // SOF0 (0xC0) or SOF2 (0xC2) — baseline or progressive
        if (marker === 0xC0 || marker === 0xC2) {
          const height = data.readUInt16BE(offset + 5);
          const width = data.readUInt16BE(offset + 7);
          if (width > 0 && height > 0 && width < 20000 && height < 20000) {
            return { width, height };
          }
        }
        // Skip to next marker
        if (marker === 0xD9 || marker === 0xDA) break; // EOI or SOS — stop
        const segLen = data.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      }
    }

    // GIF: bytes 6-9 contain width (2 bytes LE) and height (2 bytes LE)
    if (data.length > 10 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
      const width = data.readUInt16LE(6);
      const height = data.readUInt16LE(8);
      if (width > 0 && height > 0) return { width, height };
    }

    // BMP: bytes 18-25 contain width (4 bytes LE) and height (4 bytes LE)
    if (data.length > 26 && data[0] === 0x42 && data[1] === 0x4D) {
      const width = data.readInt32LE(18);
      const height = Math.abs(data.readInt32LE(22)); // height can be negative (top-down)
      if (width > 0 && height > 0) return { width, height };
    }
  } catch {
    // Ignore parsing errors
  }
  return null;
};

/**
 * Fetch an image from a URL and return its data as a Buffer.
 * Handles presigned S3 URLs and regular HTTP(S) URLs.
 * Returns null if the fetch fails or the image is SVG (unsupported in DOCX).
 */
const fetchImageFromUrl = async (url: string): Promise<{ data: Buffer; type: 'png' | 'jpg' | 'gif' | 'bmp'; naturalWidth: number; naturalHeight: number } | null> => {
  try {
    // Skip SVG images — DOCX requires raster images
    if (url.includes('.svg') && !url.includes('.svg?')) return null;

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      console.warn(`[export-docx] Failed to fetch image (${response.status}): ${url.slice(0, 100)}`);
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    // Skip SVG content type
    if (contentType.includes('svg')) return null;

    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);

    if (data.length < 100) {
      console.warn(`[export-docx] Image too small (${data.length} bytes), skipping: ${url.slice(0, 100)}`);
      return null;
    }

    const type = inferImageType(url, contentType);
    const dims = getImageDimensions(data);
    return {
      data,
      type,
      naturalWidth: dims?.width ?? DEFAULT_IMAGE_WIDTH,
      naturalHeight: dims?.height ?? DEFAULT_IMAGE_HEIGHT,
    };
  } catch (err) {
    console.warn(`[export-docx] Error fetching image: ${(err as Error).message}`);
    return null;
  }
};

/**
 * Extract image attributes from an <img> tag string.
 */
const parseImgTag = (imgTag: string): { src: string | null; width: number | null; alt: string } => {
  const srcMatch = /src="([^"]+)"/.exec(imgTag);
  const widthStyleMatch = /width:\s*(\d+)px/.exec(imgTag);
  const widthAttrMatch = /width="(\d+)"/.exec(imgTag);
  const altMatch = /alt="([^"]*)"/.exec(imgTag);

  const src = srcMatch?.[1] ?? null;
  const width = widthStyleMatch ? parseInt(widthStyleMatch[1], 10)
    : widthAttrMatch ? parseInt(widthAttrMatch[1], 10)
    : null;
  const alt = altMatch?.[1] ?? '';

  return { src, width, alt };
};

/**
 * Create a Paragraph containing an embedded image from an <img> tag.
 * Fetches the image data from the URL and embeds it in the DOCX.
 * Returns null if the image cannot be fetched.
 */
const parseImgToParagraph = async (imgTag: string): Promise<Paragraph | null> => {
  const { src, width: specifiedWidth } = parseImgTag(imgTag);
  if (!src || src.startsWith('s3key:')) return null; // s3key: prefix means unresolved — skip

  const imgResult = await fetchImageFromUrl(src);
  if (!imgResult) return null;

  const { naturalWidth, naturalHeight } = imgResult;
  const aspectRatio = naturalHeight / naturalWidth;

  // Determine display width: use specified width from HTML, or natural width, capped at max
  const displayWidth = Math.min(specifiedWidth ?? naturalWidth, MAX_IMAGE_WIDTH);
  // Calculate height preserving the actual aspect ratio
  const displayHeight = Math.round(displayWidth * aspectRatio);

  return new Paragraph({
    children: [
      new ImageRun({
        data: imgResult.data,
        transformation: { width: displayWidth, height: displayHeight },
        type: imgResult.type,
      }),
    ],
    spacing: { before: 80, after: 160 },
  });
};

// ─── HTML Entity Decoding ─────────────────────────────────────────────────────

const decodeEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201D')
    .replace(/&ldquo;/g, '\u201C')
    .replace(/&bull;/g, '\u2022')
    .replace(/&trade;/g, '\u2122')
    .replace(/&copy;/g, '\u00A9')
    .replace(/&reg;/g, '\u00AE');

// ─── Inline HTML Parser ──────────────────────────────────────────────────────

interface InlineStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

/**
 * Parse inline HTML into an array of TextRun objects.
 * Handles: <strong>, <b>, <em>, <i>, <u>, <s>, <del>, <strike>, <br>, <a>, <code>, <mark>.
 */
const parseInlineHtml = (html: string): TextRun[] => {
  const runs: TextRun[] = [];
  const tokenRe = /<(\/?)(\w+)[^>]*>|([^<]+)/g;
  let m: RegExpExecArray | null;

  const style: InlineStyle = { bold: false, italic: false, underline: false, strike: false };
  let inCode = false;

  while ((m = tokenRe.exec(html)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2]?.toLowerCase();
    const text = m[3];

    if (text !== undefined) {
      const decoded = decodeEntities(text);
      if (decoded.trim() || decoded.includes(' ')) {
        runs.push(new TextRun({
          text: decoded,
          bold: style.bold,
          italics: style.italic || undefined,
          underline: style.underline ? {} : undefined,
          strike: style.strike || undefined,
          font: inCode ? 'Courier New' : FONT_FAMILY,
          size: inCode ? FONT_SIZES.small : FONT_SIZES.body,
          color: COLORS.body,
        }));
      }
    } else if (tag === 'br') {
      runs.push(new TextRun({ text: '', break: 1 }));
    } else if (tag === 'strong' || tag === 'b') {
      style.bold = !closing;
    } else if (tag === 'em' || tag === 'i') {
      style.italic = !closing;
    } else if (tag === 'u') {
      style.underline = !closing;
    } else if (tag === 's' || tag === 'del' || tag === 'strike') {
      style.strike = !closing;
    } else if (tag === 'code') {
      inCode = !closing;
    } else if (tag === 'mark') {
      // Highlight — just continue with normal styling (DOCX highlight is limited)
    }
  }

  return runs;
};

/**
 * Strip all HTML tags and return plain decoded text.
 */
const stripHtml = (html: string): string =>
  decodeEntities(html.replace(/<[^>]+>/g, '')).trim();

// ─── List Item Parser ─────────────────────────────────────────────────────────

/**
 * Extract list items from a <ul> or <ol> block, supporting nested lists.
 */
const parseListItems = (
  listHtml: string,
  ordered: boolean,
  level = 0,
): Paragraph[] => {
  const paragraphs: Paragraph[] = [];

  // Match top-level <li> elements (non-greedy, handling nested lists)
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let li: RegExpExecArray | null;

  while ((li = liRe.exec(listHtml)) !== null) {
    const liContent = li[1] ?? '';

    // Check for nested <ul> or <ol>
    const nestedUlMatch = liContent.match(/<ul[^>]*>([\s\S]*)<\/ul>/i);
    const nestedOlMatch = liContent.match(/<ol[^>]*>([\s\S]*)<\/ol>/i);

    // Text before nested list
    const textBeforeNested = liContent
      .replace(/<ul[\s\S]*<\/ul>/gi, '')
      .replace(/<ol[\s\S]*<\/ol>/gi, '')
      .trim();

    if (textBeforeNested) {
      const runs = parseInlineHtml(textBeforeNested);
      if (runs.length) {
        if (ordered) {
          paragraphs.push(new Paragraph({
            children: runs,
            numbering: { reference: 'ordered-list', level },
            spacing: { after: 60 },
          }));
        } else {
          paragraphs.push(new Paragraph({
            children: runs,
            bullet: { level },
            spacing: { after: 60 },
          }));
        }
      }
    }

    // Process nested lists
    if (nestedUlMatch) {
      paragraphs.push(...parseListItems(nestedUlMatch[1], false, level + 1));
    }
    if (nestedOlMatch) {
      paragraphs.push(...parseListItems(nestedOlMatch[1], true, level + 1));
    }
  }

  return paragraphs;
};

// ─── Table Parser ─────────────────────────────────────────────────────────────

const THIN_BORDER = {
  style: BorderStyle.SINGLE,
  size: 1,
  color: COLORS.tableBorder,
};

/**
 * Parse an HTML <table> into a docx Table with proper borders and header shading.
 */
const parseTable = (tableHtml: string): Table | null => {
  const rows: TableRow[] = [];
  let maxCols = 1;

  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trRe.exec(tableHtml)) !== null) {
    const trInner = trMatch[1] ?? '';
    const cells: TableCell[] = [];
    let rowCols = 0;

    const cellRe = /<(th|td)([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRe.exec(trInner)) !== null) {
      const isHeader = cellMatch[1]?.toLowerCase() === 'th';
      const attrs = cellMatch[2] ?? '';
      const cellInner = cellMatch[3] ?? '';
      const plainText = stripHtml(cellInner);

      const colspanMatch = attrs.match(/colspan\s*=\s*["']?(\d+)["']?/i);
      const rowspanMatch = attrs.match(/rowspan\s*=\s*["']?(\d+)["']?/i);
      const colspan = colspanMatch ? parseInt(colspanMatch[1], 10) : 1;
      const rowspan = rowspanMatch ? parseInt(rowspanMatch[1], 10) : 1;

      rowCols += colspan;

      cells.push(
        new TableCell({
          children: [
            new Paragraph({
              children: plainText
                ? [new TextRun({
                    text: plainText,
                    bold: isHeader || undefined,
                    font: FONT_FAMILY,
                    size: FONT_SIZES.body,
                    color: COLORS.body,
                  })]
                : [new TextRun({ text: '', font: FONT_FAMILY, size: FONT_SIZES.body })],
              spacing: { before: 40, after: 40 },
            }),
          ],
          columnSpan: colspan > 1 ? colspan : undefined,
          rowSpan: rowspan > 1 ? rowspan : undefined,
          shading: isHeader
            ? { type: ShadingType.CLEAR, fill: COLORS.tableHeaderBg }
            : undefined,
          borders: {
            top: THIN_BORDER,
            bottom: THIN_BORDER,
            left: THIN_BORDER,
            right: THIN_BORDER,
          },
          margins: {
            top: convertInchesToTwip(0.04),
            bottom: convertInchesToTwip(0.04),
            left: convertInchesToTwip(0.08),
            right: convertInchesToTwip(0.08),
          },
        }),
      );
    }

    if (cells.length > 0) {
      maxCols = Math.max(maxCols, rowCols);
      rows.push(new TableRow({ children: cells }));
    }
  }

  if (!rows.length) return null;

  // 9360 DXA ≈ 6.5 inches (letter page width minus 1-inch margins)
  const tableWidth = 9360;
  return new Table({
    rows,
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: Array(maxCols).fill(Math.floor(tableWidth / maxCols)),
  });
};

// ─── Block-Level HTML Parser ──────────────────────────────────────────────────

const HEADING_MAP: Record<string, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5,
  h6: HeadingLevel.HEADING_6,
};


/**
 * Parse an HTML fragment (without TOC placeholder) into docx elements.
 * This is the core block-level parser extracted so it can be called on
 * HTML segments before and after the TOC.
 */
const parseHtmlBlocksToDocx = async (
  html: string,
  imageCache: Map<string, Paragraph | null>,
): Promise<DocxChild[]> => {
  const children: DocxChild[] = [];

  // ── Pre-process: extract TOC block before block regex (nested divs break non-greedy match) ──
  const tocOpenRe = /<div[^>]*data-table-of-contents="true"[^>]*>/i;
  const tocOpenMatch = tocOpenRe.exec(html);
  let tocFullHtml = '';
  let processedHtml = html;

  if (tocOpenMatch && tocOpenMatch.index !== undefined) {
    // Walk forward counting div depth to find matching </div>
    const start = tocOpenMatch.index;
    let depth = 1;
    const divRe = /<\/?div[\s>]/gi;
    divRe.lastIndex = start + tocOpenMatch[0].length;
    let dm: RegExpExecArray | null;
    let end = html.length;
    while ((dm = divRe.exec(html)) !== null) {
      if (dm[0].startsWith('</')) { depth--; if (depth === 0) { end = html.indexOf('>', dm.index) + 1; break; } }
      else { depth++; }
    }
    tocFullHtml = html.slice(start, end);
    // Replace TOC block with a marker the block regex won't choke on
    processedHtml = html.slice(0, start) + '<!-- TOC_PLACEHOLDER -->' + html.slice(end);
  }

  // Tokenize into top-level blocks. Order matters — standalone images, tables and lists first (greedy),
  // then individual block tags.
  const blockRe =
    /(<img[^>]*\/?>)|(<table[\s\S]*?<\/table>)|(<(?:ul|ol)[^>]*>[\s\S]*?<\/(?:ul|ol)>)|(<(h[1-6]|p|blockquote|hr|div|pre)[^>]*>([\s\S]*?)<\/\5>)|(<hr\s*\/?>)|(<div[^>]*data-page-break[^>]*>[\s\S]*?<\/div>)/gi;

  let match: RegExpExecArray | null;
  let tocInjected = false;
  const tocMarkerPos = processedHtml.indexOf('<!-- TOC_PLACEHOLDER -->');

  while ((match = blockRe.exec(processedHtml)) !== null) {
    // ── Inject TOC entries at the placeholder position ──
    if (tocFullHtml && tocMarkerPos >= 0 && match.index >= tocMarkerPos && !tocInjected) {
      tocInjected = true;
      // Parse TOC entries from the full TOC HTML via data attributes
      const entryRe = /data-toc-text="([^"]*)"[^>]*data-toc-level="(\d+)"[^>]*data-toc-pagenum="(\d+)"/gi;
      let tocEntry: RegExpExecArray | null;
      let tocMin = 9;
      const tocEntries: { text: string; level: number; pageNum: string }[] = [];
      while ((tocEntry = entryRe.exec(tocFullHtml)) !== null) {
        const text = tocEntry[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
        const level = parseInt(tocEntry[2], 10);
        if (level < tocMin) tocMin = level;
        tocEntries.push({ text, level, pageNum: tocEntry[3] });
      }
      const RIGHT_TAB = 9360;
      for (const te of tocEntries) {
        const indent = (te.level - tocMin) * 360;
        const isTop = te.level === tocMin;
        const dotCount = Math.max(3, 50 - Math.floor(te.text.length * 0.6) - (te.level - tocMin) * 2);
        const dots = ' ' + '.'.repeat(dotCount) + ' ';
        children.push(new Paragraph({
          spacing: { before: isTop ? 80 : 20, after: 20, line: 276 },
          indent: indent > 0 ? { left: indent } : undefined,
          tabStops: [{ type: 'right' as const, position: RIGHT_TAB - indent }],
          children: [
            new TextRun({ text: te.text, bold: isTop || undefined, size: FONT_SIZES.body, color: COLORS.body, font: FONT_FAMILY }),
            new TextRun({ text: dots, size: 16, color: COLORS.muted, font: 'Courier New' }),
            new TextRun({ children: [new Tab()], size: FONT_SIZES.body }),
            new TextRun({ text: te.pageNum, size: FONT_SIZES.body, color: COLORS.body, font: FONT_FAMILY }),
          ],
        }));
      }
    }

    const standaloneImg = match[1];
    const tableHtml = match[2];
    const listHtml = match[3];
    const blockTag = match[5]?.toLowerCase();
    const blockInner = match[6] ?? '';
    const hrSelfClosing = match[7];
    const pageBreakDiv = match[8];

    // ── Standalone image (not inside a <p>) ──
    if (standaloneImg) {
      const imgPara = imageCache.get(standaloneImg) ?? await parseImgToParagraph(standaloneImg);
      if (imgPara) children.push(imgPara);
      continue;
    }

    // ── Page break ──
    if (pageBreakDiv) {
      children.push(new Paragraph({
        children: [new PageBreak()],
      }));
      continue;
    }

    // ── Table ──
    if (tableHtml) {
      const table = parseTable(tableHtml);
      if (table) {
        children.push(table);
        // Add spacing after table
        children.push(new Paragraph({ children: [new TextRun('')], spacing: { after: 120 } }));
      }
      continue;
    }

    // ── Lists ──
    if (listHtml) {
      const isOrdered = /^<ol/i.test(listHtml);
      // Extract inner content (between opening and closing list tags)
      const innerMatch = listHtml.match(/^<(?:ul|ol)[^>]*>([\s\S]*)<\/(?:ul|ol)>$/i);
      if (innerMatch) {
        const items = parseListItems(innerMatch[1], isOrdered);
        children.push(...items);
      }
      continue;
    }

    // ── Self-closing HR ──
    if (hrSelfClosing) {
      children.push(new Paragraph({
        children: [new TextRun('')],
        spacing: { before: 120, after: 120 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB', space: 1 },
        },
      }));
      continue;
    }

    if (!blockTag) continue;

    // ── Headings ──
    if (HEADING_MAP[blockTag]) {
      const text = stripHtml(blockInner);
      if (text) {
        // Extract text-align from inline style if present
        const fullTag = match[4] ?? '';
        const alignMatch = fullTag.match(/text-align:\s*(center|right|justify)/i);
        const alignment = alignMatch
          ? alignMatch[1] === 'center' ? AlignmentType.CENTER
            : alignMatch[1] === 'right' ? AlignmentType.RIGHT
            : alignMatch[1] === 'justify' ? AlignmentType.JUSTIFIED
            : undefined
          : undefined;

        children.push(new Paragraph({
          text,
          heading: HEADING_MAP[blockTag],
          alignment,
          spacing: {
            before: blockTag === 'h1' ? 360 : blockTag === 'h2' ? 300 : 240,
            after: 120,
          },
        }));
      }
      continue;
    }

    // ── Paragraph ──
    if (blockTag === 'p') {
      // Check for &nbsp; only (blank line placeholder)
      const trimmed = blockInner.trim();
      if (trimmed === '&nbsp;' || trimmed === '') {
        children.push(new Paragraph({
          children: [new TextRun({ text: '', font: FONT_FAMILY, size: FONT_SIZES.body })],
          spacing: { after: 120 },
        }));
        continue;
      }

      // Check for image inside paragraph
      const imgInPara = /<img[^>]*>/i.exec(blockInner);
      if (imgInPara) {
        const imgPara = imageCache.get(imgInPara[0]) ?? await parseImgToParagraph(imgInPara[0]);
        if (imgPara) {
          children.push(imgPara);
          // Also add any text content around the image
          const textAround = stripHtml(blockInner.replace(/<img[^>]*>/gi, ''));
          if (textAround) {
            children.push(new Paragraph({
              children: parseInlineHtml(blockInner.replace(/<img[^>]*>/gi, '')),
              spacing: { after: 160 },
            }));
          }
        }
        continue;
      }

      const runs = parseInlineHtml(blockInner);
      if (runs.length) {
        // Extract text-align from inline style if present
        const pTag = match[4] ?? '';
        const pAlignMatch = pTag.match(/text-align:\s*(center|right|justify)/i);
        const pAlignment = pAlignMatch
          ? pAlignMatch[1] === 'center' ? AlignmentType.CENTER
            : pAlignMatch[1] === 'right' ? AlignmentType.RIGHT
            : pAlignMatch[1] === 'justify' ? AlignmentType.JUSTIFIED
            : undefined
          : undefined;

        children.push(new Paragraph({
          children: runs,
          alignment: pAlignment,
          spacing: { after: 160 },
        }));
      }
      continue;
    }

    // ── Blockquote ──
    if (blockTag === 'blockquote') {
      // Extract inner paragraphs or treat as single block
      const innerParagraphs = blockInner.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
      if (innerParagraphs) {
        for (const innerP of innerParagraphs) {
          const pContent = innerP.replace(/<\/?p[^>]*>/gi, '');
          const text = stripHtml(pContent);
          if (text) {
            children.push(new Paragraph({
              children: [new TextRun({
                text,
                italics: true,
                font: FONT_FAMILY,
                size: FONT_SIZES.body,
                color: COLORS.muted,
              })],
              indent: { left: convertInchesToTwip(0.5) },
              spacing: { after: 120 },
              border: {
                left: { style: BorderStyle.SINGLE, size: 6, color: COLORS.blockquoteBorder, space: 8 },
              },
            }));
          }
        }
      } else {
        const text = stripHtml(blockInner);
        if (text) {
          children.push(new Paragraph({
            children: [new TextRun({
              text,
              italics: true,
              font: FONT_FAMILY,
              size: FONT_SIZES.body,
              color: COLORS.muted,
            })],
            indent: { left: convertInchesToTwip(0.5) },
            spacing: { after: 120 },
            border: {
              left: { style: BorderStyle.SINGLE, size: 6, color: COLORS.blockquoteBorder, space: 8 },
            },
          }));
        }
      }
      continue;
    }

    // ── Pre (code block) ──
    if (blockTag === 'pre') {
      const codeText = stripHtml(blockInner);
      if (codeText) {
        // Split by newlines and create individual paragraphs for code
        const codeLines = codeText.split('\n');
        for (const line of codeLines) {
          children.push(new Paragraph({
            children: [new TextRun({
              text: line || ' ',
              font: 'Courier New',
              size: FONT_SIZES.small,
              color: COLORS.body,
            })],
            spacing: { after: 0 },
            indent: { left: convertInchesToTwip(0.25) },
            shading: { type: ShadingType.CLEAR, fill: 'F3F4F6' },
          }));
        }
        // Add spacing after code block
        children.push(new Paragraph({
          children: [new TextRun('')],
          spacing: { after: 160 },
        }));
      }
      continue;
    }

    // ── HR ──
    if (blockTag === 'hr') {
      children.push(new Paragraph({
        children: [new TextRun('')],
        spacing: { before: 120, after: 120 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB', space: 1 },
        },
      }));
      continue;
    }

    // ── Div / other block — extract text ──
    if (blockTag === 'div') {
      // Check for page break divs
      if (match[0]?.includes('data-page-break') || match[0]?.includes('page-break-node')) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
        continue;
      }

      // TOC fragments already handled by pre-processor above — skip any remnants
      if (match[0]?.includes('data-toc-text') || match[0]?.includes('toc-entry')) {
        continue;
      }

      const text = stripHtml(blockInner);
      if (text) {
        children.push(new Paragraph({
          children: [new TextRun({
            text,
            font: FONT_FAMILY,
            size: FONT_SIZES.body,
            color: COLORS.body,
          })],
          spacing: { after: 160 },
        }));
      }
      continue;
    }

    // Fallback: extract text from unknown block
    const fallbackText = stripHtml(blockInner);
    if (fallbackText) {
      children.push(new Paragraph({
        children: [new TextRun({
          text: fallbackText,
          font: FONT_FAMILY,
          size: FONT_SIZES.body,
          color: COLORS.body,
        })],
        spacing: { after: 160 },
      }));
    }
  }

  return children;
};

/**
 * Parse the full HTML body into an array of docx elements.
 * Async because image fetching requires network calls.
 *
 * The HTML is expected to have TOC placeholders already expanded by
 * `expandTableOfContents` (same as PDF/HTML) so the TOC renders as
 * styled divs that the block parser handles like any other content.
 */
const parseHtmlToDocxChildren = async (html: string): Promise<DocxChild[]> => {
  // Collect all image URLs for parallel pre-fetching
  const imgTagRe = /<img[^>]*>/gi;
  const imgTags: string[] = [];
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgTagRe.exec(html)) !== null) {
    imgTags.push(imgMatch[0]);
  }

  // Pre-fetch all images in parallel for performance
  const imageCache = new Map<string, Paragraph | null>();
  if (imgTags.length > 0) {
    const fetchPromises = imgTags.map(async (tag) => {
      const result = await parseImgToParagraph(tag);
      imageCache.set(tag, result);
    });
    await Promise.all(fetchPromises);
  }

  const children = await parseHtmlBlocksToDocx(html, imageCache);

  // If nothing was parsed, add an empty paragraph
  if (!children.length) {
    children.push(new Paragraph({
      children: [new TextRun({ text: '', font: FONT_FAMILY, size: FONT_SIZES.body })],
    }));
  }

  return children;
};

// ─── Page Furniture (running headers & footers) ───────────────────────────────

const FURNITURE_ALIGNMENT = {
  LEFT: AlignmentType.LEFT,
  CENTER: AlignmentType.CENTER,
  RIGHT: AlignmentType.RIGHT,
} as const;

/**
 * Split furniture HTML into paragraphs, mapping page tokens to live Word fields.
 *
 * `{{PAGE_NUMBER}}` / `{{TOTAL_PAGES}}` become `PageNumber.CURRENT` /
 * `PageNumber.TOTAL_PAGES` field runs rather than literal text, so the numbers
 * stay correct when the document is repaginated in Word. Baking in a number at
 * export time would freeze it at whatever the server measured.
 *
 * Images are inlined as data URIs first, because the shared image path skips any
 * `src` still on the `s3key:` scheme — which would drop the logo with no error.
 */
const buildFurnitureChildren = async (part: PageFurniture): Promise<Paragraph[]> => {
  const alignment = FURNITURE_ALIGNMENT[part.align];
  const withImages = await inlineFurnitureImages(part.html);

  // Cap furniture images to the band height so a full-size logo cannot push the
  // header into the body text. 96 DPI, matching MAX_IMAGE_WIDTH's basis.
  const maxBandHeightPx = Math.max(1, Math.round(part.heightIn * 96));

  const paragraphs: Paragraph[] = [];
  // Handle each block separately so an image and a caption don't collapse together.
  const blocks = withImages.split(/<\/p>|<br\s*\/?>/i).filter((b) => b.trim());
  const effectiveBlocks = blocks.length ? blocks : [withImages];

  for (const block of effectiveBlocks) {
    const imgTag = /<img[^>]*>/i.exec(block)?.[0];
    if (imgTag) {
      const { src, width: specifiedWidth } = parseImgTag(imgTag);
      const img = src ? await fetchImageFromUrl(src) : null;
      if (img) {
        const aspect = img.naturalHeight / img.naturalWidth;
        let width = Math.min(specifiedWidth ?? img.naturalWidth, MAX_IMAGE_WIDTH);
        let height = Math.round(width * aspect);
        if (height > maxBandHeightPx) {
          height = maxBandHeightPx;
          width = Math.max(1, Math.round(height / aspect));
        }
        paragraphs.push(new Paragraph({
          children: [new ImageRun({
            data: img.data,
            transformation: { width, height },
            type: img.type,
          })],
          alignment,
          spacing: { before: 0, after: 0 },
        }));
      } else if (src) {
        console.warn(`[export-docx] Furniture image could not be embedded: ${src.slice(0, 80)}`);
      }
      const withoutImg = block.replace(/<img[^>]*>/gi, '');
      if (!withoutImg.replace(/<[^>]+>/g, '').trim()) continue;
    }

    const runs: TextRun[] = [];
    // Split on the reserved tokens, keeping them so each becomes a field run.
    const segments = block.split(/(\{\{PAGE_NUMBER\}\}|\{\{TOTAL_PAGES\}\})/g);
    for (const segment of segments) {
      if (!segment) continue;
      if (segment === '{{PAGE_NUMBER}}') {
        runs.push(new TextRun({
          children: [PageNumber.CURRENT],
          font: FONT_FAMILY,
          size: FONT_SIZES.small,
          color: COLORS.muted,
        }));
      } else if (segment === '{{TOTAL_PAGES}}') {
        runs.push(new TextRun({
          children: [PageNumber.TOTAL_PAGES],
          font: FONT_FAMILY,
          size: FONT_SIZES.small,
          color: COLORS.muted,
        }));
      } else {
        runs.push(...parseInlineHtml(segment));
      }
    }

    if (runs.length) {
      paragraphs.push(new Paragraph({ children: runs, alignment, spacing: { before: 0, after: 0 } }));
    }
  }

  // A Header/Footer with no children at all is invalid OOXML; emit a blank line.
  if (!paragraphs.length) paragraphs.push(new Paragraph({ children: [] }));
  return paragraphs;
};

/**
 * Build the `headers`/`footers` for one document section.
 *
 * A suppressed slot gets an explicitly empty `Header`/`Footer` rather than being
 * omitted — omitting it makes Word inherit the previous section's furniture,
 * which is the opposite of what a per-section "off" toggle means.
 */
const buildSectionFurniture = async (
  furniture: TemplateFurniture | undefined,
  visible: { showHeader: boolean; showFooter: boolean },
): Promise<{ headers?: { default: Header }; footers?: { default: Footer } }> => {
  const result: { headers?: { default: Header }; footers?: { default: Footer } } = {};
  if (!furniture) return result;

  result.headers = {
    default: visible.showHeader
      ? new Header({ children: await buildFurnitureChildren(furniture.header) })
      : new Header({ children: [] }),
  };
  result.footers = {
    default: visible.showFooter
      ? new Footer({ children: await buildFurnitureChildren(furniture.footer) })
      : new Footer({ children: [] }),
  };
  return result;
};

// ─── Document Builder ─────────────────────────────────────────────────────────

/**
 * Convert raw editor HTML to a DOCX Buffer using the native `docx` library.
 *
 * Produces a properly formatted Word document with:
 * - Professional heading styles (no underlines)
 * - Proper bullet and numbered lists
 * - Tables with borders and header shading
 * - Blockquotes with left border
 * - Code blocks in monospace font
 * - Page break support
 * - Configurable page size and margins
 *
 * @param html  Raw HTML body content from the editor
 * @param options  DOCX generation options
 * @returns DOCX as a Node.js Buffer
 */
export const htmlToDocxBuffer = async (
  html: string,
  options: HtmlToDocxOptions = {},
): Promise<Buffer> => {
  const {
    title = 'Document',
    pageSize = 'letter',
    creator = 'AutoRFP',
    description,
    furniture,
  } = options;

  // Page dimensions in twips (1 inch = 1440 twips)
  const pageSizeConfig = pageSize === 'a4'
    ? { width: 11906, height: 16838 }  // A4: 210mm × 297mm
    : { width: 12240, height: 15840 }; // Letter: 8.5in × 11in

  /**
   * Build the document sections.
   *
   * A single section is used whenever possible, because splitting on page breaks
   * changes how Word handles list numbering continuation and the native TOC.
   * Only a per-section furniture override justifies the extra sections: they are
   * the sole way OOXML can express "no header on the cover page", since each
   * section owns its own header/footer definitions.
   */
  const buildSections = async () => {
    const sectionMargin = (visible: { showHeader: boolean; showFooter: boolean }) => {
      const { topIn, bottomIn } = marginForFurniture(furniture, visible);
      return {
        top: Math.round(topIn * TWIPS_PER_INCH),
        right: TWIPS_PER_INCH,
        bottom: Math.round(bottomIn * TWIPS_PER_INCH),
        left: TWIPS_PER_INCH,
      };
    };

    if (!hasSectionOverrides(furniture)) {
      // Uniform furniture — one section, inline page breaks preserved as-is.
      const visible = resolveFurnitureVisibility(furniture, 0);
      return [{
        properties: { page: { size: pageSizeConfig, margin: sectionMargin(visible) } },
        ...(await buildSectionFurniture(furniture, visible)),
        children: await parseHtmlToDocxChildren(html),
      }];
    }

    // Per-section overrides — emit one real OOXML section per page-break group.
    const htmlSections = splitIntoFurnitureSections(html);
    const sections = [];
    for (let i = 0; i < htmlSections.length; i++) {
      const visible = resolveFurnitureVisibility(furniture, i);
      sections.push({
        properties: {
          page: { size: pageSizeConfig, margin: sectionMargin(visible) },
          // NEXT_PAGE reproduces the page break that splitting consumed.
          ...(i > 0 ? { type: SectionType.NEXT_PAGE } : {}),
        },
        ...(await buildSectionFurniture(furniture, visible)),
        children: await parseHtmlToDocxChildren(htmlSections[i]),
      });
    }
    return sections;
  };

  const sections = await buildSections();

  const doc = new Document({
    creator,
    title,
    description: description ?? 'Exported from AutoRFP',
    styles: {
      default: {
        document: {
          run: {
            font: FONT_FAMILY,
            size: FONT_SIZES.body,
            color: COLORS.body,
          },
          paragraph: {
            spacing: { line: 276 }, // 1.15x line spacing
          },
        },
        heading1: {
          run: {
            font: FONT_FAMILY,
            size: FONT_SIZES.heading1,
            bold: true,
            color: COLORS.heading1,
          },
          paragraph: {
            spacing: { before: 360, after: 120 },
          },
        },
        heading2: {
          run: {
            font: FONT_FAMILY,
            size: FONT_SIZES.heading2,
            bold: true,
            color: COLORS.heading2,
          },
          paragraph: {
            spacing: { before: 300, after: 100 },
          },
        },
        heading3: {
          run: {
            font: FONT_FAMILY,
            size: FONT_SIZES.heading3,
            bold: true,
            color: COLORS.heading3,
          },
          paragraph: {
            spacing: { before: 240, after: 80 },
          },
        },
        heading4: {
          run: {
            font: FONT_FAMILY,
            size: FONT_SIZES.heading4,
            bold: true,
            color: COLORS.heading4,
          },
          paragraph: {
            spacing: { before: 200, after: 60 },
          },
        },
        heading5: {
          run: {
            font: FONT_FAMILY,
            size: FONT_SIZES.body,
            bold: true,
            color: COLORS.heading4,
          },
          paragraph: {
            spacing: { before: 160, after: 60 },
          },
        },
        heading6: {
          run: {
            font: FONT_FAMILY,
            size: FONT_SIZES.body,
            bold: true,
            italics: true,
            color: COLORS.heading4,
          },
          paragraph: {
            spacing: { before: 160, after: 60 },
          },
        },
      },
      paragraphStyles: [
        // US-standard TOC styles: Times New Roman or Calibri, 12pt for level 1,
        // 11pt for sub-levels, right-aligned tab stop with dot leader for page numbers,
        // indentation increases by 0.25" per level (360 twips).
        {
          id: 'TOC1',
          name: 'TOC 1',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: FONT_FAMILY, size: FONT_SIZES.body, color: COLORS.body },
          paragraph: {
            spacing: { before: 120, after: 60, line: 276 },
            indent: { left: 0 },
          },
        },
        {
          id: 'TOC2',
          name: 'TOC 2',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: FONT_FAMILY, size: FONT_SIZES.body, color: COLORS.body },
          paragraph: {
            spacing: { before: 40, after: 40, line: 276 },
            indent: { left: 360 }, // 0.25 inch
          },
        },
        {
          id: 'TOC3',
          name: 'TOC 3',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: FONT_FAMILY, size: FONT_SIZES.body, color: COLORS.muted },
          paragraph: {
            spacing: { before: 20, after: 20, line: 276 },
            indent: { left: 720 }, // 0.5 inch
          },
        },
        {
          id: 'TOC4',
          name: 'TOC 4',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: FONT_FAMILY, size: FONT_SIZES.small, color: COLORS.muted },
          paragraph: {
            spacing: { before: 20, after: 20, line: 276 },
            indent: { left: 1080 }, // 0.75 inch
          },
        },
        {
          id: 'TOC5',
          name: 'TOC 5',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: FONT_FAMILY, size: FONT_SIZES.small, color: COLORS.muted },
          paragraph: {
            spacing: { before: 20, after: 20, line: 276 },
            indent: { left: 1440 }, // 1.0 inch
          },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'ordered-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 1,
              format: LevelFormat.LOWER_LETTER,
              text: '%2.',
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(1.0), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 2,
              format: LevelFormat.LOWER_ROMAN,
              text: '%3.',
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(1.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
          ],
        },
      ],
    },
    sections,
  });

  const buffer = await Packer.toBuffer(doc);

  // Packer.toBuffer returns Buffer in Node.js
  if (Buffer.isBuffer(buffer)) {
    return buffer;
  }

  return Buffer.from(buffer);
};

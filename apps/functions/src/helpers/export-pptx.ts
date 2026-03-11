/**
 * Server-side HTML → PPTX conversion using PptxGenJS.
 *
 * Parses the HTML content into structured sections and generates
 * a clean, modern PowerPoint presentation.
 */

import PptxGenJS from 'pptxgenjs';
import { type RFPDocumentContent } from '@auto-rfp/core';

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  primary:   '4338CA',  // indigo-700
  dark:      '1E1B4B',  // indigo-950
  accent:    '6366F1',  // indigo-500
  light:     'EEF2FF',  // indigo-50
  body:      '374151',  // gray-700
  muted:     '6B7280',  // gray-500
  white:     'FFFFFF',
  offWhite:  'F9FAFB',  // gray-50
  border:    'E5E7EB',  // gray-200
  success:   '059669',  // emerald-600
};

const W = 13.33;
const H = 7.5;

// ─── HTML parsing ─────────────────────────────────────────────────────────────

const strip = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

interface Section {
  title: string;
  level: 1 | 2;
  bullets: string[];
  paragraphs: string[];
  tableRows: string[][];
}

const parseSections = (html: string): Section[] => {
  if (!html) return [];
  const sections: Section[] = [];
  const parts = html.split(/(?=<h[12][^>]*>)/i);

  for (const part of parts) {
    if (!part.trim()) continue;
    const m = part.match(/^<h([12])[^>]*>(.*?)<\/h[12]>/i);
    if (!m) continue;

    const level = parseInt(m[1]!, 10) as 1 | 2;
    const title = strip(m[2]!).trim();
    const body = part.slice(m[0].length);

    const bullets: string[] = [];
    let li: RegExpExecArray | null;
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    while ((li = liRe.exec(body)) !== null) {
      const t = strip(li[1]!).trim();
      if (t) bullets.push(t);
    }

    const noLists = body.replace(/<[uo]l[^>]*>[\s\S]*?<\/[uo]l>/gi, '');
    const paragraphs: string[] = [];
    let p: RegExpExecArray | null;
    const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    while ((p = pRe.exec(noLists)) !== null) {
      const t = strip(p[1]!).trim();
      if (t && t.length > 10) paragraphs.push(t);
    }

    const tableRows: string[][] = [];
    let tr: RegExpExecArray | null;
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    while ((tr = trRe.exec(body)) !== null) {
      const cells: string[] = [];
      let td: RegExpExecArray | null;
      const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      while ((td = tdRe.exec(tr[1]!)) !== null) cells.push(strip(td[1]!).trim());
      if (cells.length) tableRows.push(cells);
    }

    if (title) sections.push({ title, level, bullets, paragraphs, tableRows });
  }
  return sections;
};

// ─── Slide helpers ────────────────────────────────────────────────────────────

const truncate = (s: string, max: number) =>
  s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';

/** Thin accent bar on the left edge of every slide */
const accentBar = (slide: PptxGenJS.Slide, pptx: PptxGenJS) => {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.08, h: H,
    fill: { color: C.accent },
    line: { color: C.accent },
  });
};

// ─── Slide builders ───────────────────────────────────────────────────────────

const titleSlide = (pptx: PptxGenJS, doc: RFPDocumentContent) => {
  const slide = pptx.addSlide();

  // Dark background
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: H,
    fill: { color: C.dark },
    line: { color: C.dark },
  });

  // Accent bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.12, h: H,
    fill: { color: C.accent },
    line: { color: C.accent },
  });

  // Decorative gradient circle
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 8.5, y: -2, w: 7, h: 7,
    fill: { color: C.primary, transparency: 50 },
    line: { color: C.primary, transparency: 50 },
  });

  // Title
  slide.addText(doc.title, {
    x: 0.8, y: 1.8, w: 11, h: 2,
    fontSize: 36, bold: true, color: C.white,
    align: 'left', valign: 'middle', wrap: true,
    fontFace: 'Calibri',
  });

  // Divider
  slide.addShape(pptx.ShapeType.line, {
    x: 0.8, y: 4.0, w: 4, h: 0,
    line: { color: C.accent, width: 3 },
  });

  // Metadata
  const meta: string[] = [];
  if (doc.customerName) meta.push(doc.customerName);
  if (doc.opportunityId) meta.push(`Opp: ${doc.opportunityId}`);
  meta.push(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));

  slide.addText(meta.join('  ·  '), {
    x: 0.8, y: 4.3, w: 11, h: 0.5,
    fontSize: 13, color: 'A5B4FC', // indigo-300
    fontFace: 'Calibri',
  });
};

const agendaSlide = (pptx: PptxGenJS, sections: Section[]) => {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  accentBar(slide, pptx);

  // Header
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: 0.9,
    fill: { color: C.light },
    line: { color: C.light },
  });
  slide.addText('Contents', {
    x: 0.5, y: 0, w: 12, h: 0.9,
    fontSize: 24, bold: true, color: C.primary,
    valign: 'middle', fontFace: 'Calibri',
  });

  const items = sections.filter(s => s.level === 2).slice(0, 12);
  const cols = items.length > 6 ? 2 : 1;
  const perCol = Math.ceil(items.length / cols);

  items.forEach((s, i) => {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const x = 0.6 + col * 6.2;
    const y = 1.2 + row * 0.52;

    // Number
    slide.addText(String(i + 1).padStart(2, '0'), {
      x, y, w: 0.5, h: 0.42,
      fontSize: 12, bold: true, color: C.accent,
      fontFace: 'Calibri',
    });

    // Title
    slide.addText(truncate(s.title, 60), {
      x: x + 0.55, y, w: cols === 2 ? 5.3 : 11.5, h: 0.42,
      fontSize: 14, color: C.body,
      valign: 'middle', fontFace: 'Calibri',
    });
  });
};

const dividerSlide = (pptx: PptxGenJS, title: string, num: number) => {
  const slide = pptx.addSlide();

  // Gradient background
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: H,
    fill: { color: C.primary },
    line: { color: C.primary },
  });

  // Accent bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.12, h: H,
    fill: { color: C.accent },
    line: { color: C.accent },
  });

  // Large section number
  slide.addText(String(num).padStart(2, '0'), {
    x: 0.6, y: 1.2, w: 3, h: 1.5,
    fontSize: 72, bold: true, color: C.accent,
    fontFace: 'Calibri',
  });

  // Divider line
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.6, y: 3.0, w: 3, h: 0.04,
    fill: { color: C.accent },
    line: { color: C.accent },
  });

  // Section title
  slide.addText(title, {
    x: 0.6, y: 3.3, w: 12, h: 1.8,
    fontSize: 28, bold: true, color: C.white,
    wrap: true, valign: 'top', fontFace: 'Calibri',
  });
};

const contentSlide = (pptx: PptxGenJS, section: Section) => {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  accentBar(slide, pptx);

  // Title bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: 0.8,
    fill: { color: C.light },
    line: { color: C.light },
  });
  slide.addText(truncate(section.title, 80), {
    x: 0.4, y: 0, w: 12.5, h: 0.8,
    fontSize: 20, bold: true, color: C.primary,
    valign: 'middle', fontFace: 'Calibri',
  });

  const top = 1.0;
  const contentH = H - top - 0.3;

  // ── Table content ──
  if (section.tableRows.length > 0) {
    const rows = section.tableRows.slice(0, 10);
    const colCount = Math.max(...rows.map(r => r.length));
    const colW = 12.5 / colCount;

    const tableRows: PptxGenJS.TableRow[] = rows.map((row, ri) =>
      row.map(cell => ({
        text: truncate(cell, 80),
        options: {
          fontSize: 10,
          color: ri === 0 ? C.white : C.body,
          bold: ri === 0,
          fill: { color: ri === 0 ? C.primary : ri % 2 === 0 ? C.offWhite : C.white },
          border: { type: 'solid' as const, pt: 0.5, color: C.border },
          valign: 'middle' as const,
          fontFace: 'Calibri',
        },
      })),
    );

    slide.addTable(tableRows, {
      x: 0.4, y: top, w: 12.5,
      colW: Array(colCount).fill(colW),
      rowH: 0.38,
      border: { type: 'solid', pt: 0.5, color: C.border },
    });
    return;
  }

  // ── Bullet content ──
  if (section.bullets.length > 0) {
    const items = section.bullets.slice(0, 14);

    // If many bullets, use 2 columns
    if (items.length > 7) {
      const mid = Math.ceil(items.length / 2);
      const left = items.slice(0, mid);
      const right = items.slice(mid);

      [{ data: left, x: 0.4 }, { data: right, x: 6.8 }].forEach(({ data, x }) => {
        slide.addText(
          data.map(b => ({ text: truncate(b, 100), options: {} })),
          {
            x, y: top, w: 6.0, h: contentH,
            fontSize: 12, color: C.body,
            bullet: { type: 'bullet', characterCode: '2022', indent: 10 },
            paraSpaceAfter: 6, valign: 'top', fontFace: 'Calibri',
          },
        );
      });
    } else {
      slide.addText(
        items.map(b => ({ text: truncate(b, 140), options: {} })),
        {
          x: 0.4, y: top, w: 12.5, h: contentH,
          fontSize: 13, color: C.body,
          bullet: { type: 'bullet', characterCode: '2022', indent: 12 },
          paraSpaceAfter: 8, valign: 'top', fontFace: 'Calibri',
        },
      );
    }
    return;
  }

  // ── Paragraph content ──
  if (section.paragraphs.length > 0) {
    const text = section.paragraphs
      .slice(0, 4)
      .map(p => truncate(p, 500))
      .join('\n\n');

    slide.addText(text, {
      x: 0.4, y: top, w: 12.5, h: contentH,
      fontSize: 12, color: C.body,
      valign: 'top', wrap: true,
      paraSpaceAfter: 8, fontFace: 'Calibri',
    });
  }
};

const closingSlide = (pptx: PptxGenJS, doc: RFPDocumentContent) => {
  const slide = pptx.addSlide();

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: H,
    fill: { color: C.dark },
    line: { color: C.dark },
  });

  // Decorative circles
  slide.addShape(pptx.ShapeType.ellipse, {
    x: -2, y: -2, w: 6, h: 6,
    fill: { color: C.primary, transparency: 60 },
    line: { color: C.primary, transparency: 60 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 10, y: 4, w: 5, h: 5,
    fill: { color: C.accent, transparency: 70 },
    line: { color: C.accent, transparency: 70 },
  });

  slide.addText('Thank You', {
    x: 0, y: 2.0, w: W, h: 1.5,
    fontSize: 48, bold: true, color: C.white,
    align: 'center', valign: 'middle', fontFace: 'Calibri',
  });

  // Divider
  slide.addShape(pptx.ShapeType.rect, {
    x: W / 2 - 1.5, y: 3.8, w: 3, h: 0.04,
    fill: { color: C.accent },
    line: { color: C.accent },
  });

  if (doc.customerName) {
    slide.addText(`Prepared for ${doc.customerName}`, {
      x: 0, y: 4.1, w: W, h: 0.5,
      fontSize: 14, color: 'A5B4FC',
      align: 'center', fontFace: 'Calibri',
    });
  }

  slide.addText('CONFIDENTIAL', {
    x: 0, y: H - 0.4, w: W, h: 0.3,
    fontSize: 8, color: C.muted,
    align: 'center', fontFace: 'Calibri',
  });
};

// ─── Main export ──────────────────────────────────────────────────────────────

export interface HtmlToPptxOptions {
  title?: string;
  customerName?: string | null;
  opportunityId?: string | null;
  outlineSummary?: string | null;
}

/**
 * Convert raw editor HTML to a PPTX Buffer.
 */
export const htmlToPptxBuffer = async (
  html: string,
  options: HtmlToPptxOptions = {},
): Promise<Buffer> => {
  const {
    title = 'Document',
    customerName = null,
    opportunityId = null,
    outlineSummary = null,
  } = options;

  const doc: RFPDocumentContent = { title, customerName, opportunityId, outlineSummary, content: html };

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'AutoRFP';
  pptx.title = title;
  pptx.subject = customerName ?? '';

  const sections = parseSections(html);
  const h2s = sections.filter(s => s.level === 2);

  // 1. Title
  titleSlide(pptx, doc);

  // 2. Agenda (if 2+ sections)
  if (h2s.length > 1) {
    agendaSlide(pptx, sections);
  }

  // 3. Executive summary
  if (outlineSummary) {
    contentSlide(pptx, {
      title: 'Executive Summary',
      level: 2,
      bullets: [],
      paragraphs: [outlineSummary],
      tableRows: [],
    });
  }

  // 4. Section slides
  let num = 1;
  for (const section of h2s) {
    dividerSlide(pptx, section.title, num);
    contentSlide(pptx, section);
    num++;
  }

  // 5. Closing
  closingSlide(pptx, doc);

  return await pptx.write({ outputType: 'nodebuffer' }) as Buffer;
};

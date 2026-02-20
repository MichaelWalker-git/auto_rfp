import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import { ProposalDocument } from '@auto-rfp/core';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

function sanitizeFileName(name: string) {
  return (name || 'proposal')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── DOCX ─────────────────────────────────────────────────────────────────────

function buildProposalDocx(proposalDoc: ProposalDocument) {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: proposalDoc.title || 'Proposal', bold: true, size: 36 })],
    }),
  );

  if (proposalDoc.outlineSummary) {
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Executive Summary' }));
    children.push(new Paragraph({
      style: 'Normal',
      text: '',
      children: [new TextRun({ text: proposalDoc.outlineSummary })],
    }));
  }

  // Parse htmlContent into Word paragraphs
  if (proposalDoc.content) {
    const tokenRegex = /<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>|([^<]+)/gi;
    let token: RegExpExecArray | null;
    while ((token = tokenRegex.exec(proposalDoc.content)) !== null) {
      const tag = token[1]?.toLowerCase();
      const rawText = (token[2] ?? token[3] ?? '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
        .trim();

      if (!rawText) continue;

      if (tag === 'h1') {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: rawText, bold: true })] }));
      } else if (tag === 'h2') {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: rawText, bold: true })] }));
      } else if (tag === 'h3') {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: rawText, bold: true })] }));
      } else if (tag === 'h4') {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_4, children: [new TextRun({ text: rawText })] }));
      } else if (tag === 'li') {
        children.push(new Paragraph({ bullet: { level: 0 }, text: rawText }));
      } else {
        children.push(new Paragraph({ text: rawText }));
      }
    }
  }

  return new Document({ sections: [{ children }] });
}

export async function exportProposalToDocx(proposalDoc: ProposalDocument) {
  const doc = buildProposalDocx(proposalDoc);
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${sanitizeFileName(proposalDoc.title)}.docx`);
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

export async function exportProposalToPdf(proposalDoc: ProposalDocument) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 48;
  const lineHeight = 14;
  const titleSize = 18;
  const h2Size = 14;
  const textSize = 11;

  const wrapText = (text: string, maxWidth: number, f: typeof font, size: number): string[] => {
    const words = (text || '').replace(/\r\n/g, '\n').split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      const width = f.widthOfTextAtSize(next, size);
      if (width <= maxWidth) line = next;
      else {
        if (line) lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  let page = pdfDoc.addPage();
  let { width, height } = page.getSize();
  const x = margin;
  let y = height - margin;

  const ensureSpace = (needed: number) => {
    if (y - needed < margin) {
      page = pdfDoc.addPage();
      ({ width, height } = page.getSize());
      y = height - margin;
    }
  };

  const drawLine = (text: string, size = textSize, bold = false, color = rgb(0, 0, 0)) => {
    ensureSpace(lineHeight + 2);
    page.drawText(text, { x, y, size, font: bold ? fontBold : font, color });
    y -= lineHeight;
  };

  const drawParagraph = (text: string, size = textSize, bold = false) => {
    const maxWidth = width - margin * 2;
    const lines = wrapText(text || '', maxWidth, bold ? fontBold : font, size);
    for (const line of lines) drawLine(line, size, bold);
    y -= 6;
  };

  drawParagraph(proposalDoc.title || 'Proposal', titleSize, true);

  if (proposalDoc.outlineSummary) {
    drawLine('Executive Summary', h2Size, true, rgb(0.1, 0.1, 0.1));
    drawParagraph(proposalDoc.outlineSummary, textSize, false);
  }

  if (proposalDoc.content) {
    const plainText = stripHtml(proposalDoc.content);
    const blocks = plainText.split(/\n{2,}/);
    for (const block of blocks) {
      const trimmed = block.trim();
      if (trimmed) drawParagraph(trimmed, textSize, false);
    }
  }

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFileName(proposalDoc.title)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ─── Plain text ───────────────────────────────────────────────────────────────

export function exportProposalToText(doc: ProposalDocument) {
  const lines: string[] = [];
  lines.push(doc.title);
  lines.push('='.repeat(doc.title.length));
  lines.push('');

  if (doc.customerName) {
    lines.push(`Customer: ${doc.customerName}`);
    lines.push('');
  }

  if (doc.outlineSummary) {
    lines.push('Executive Summary');
    lines.push('-'.repeat(17));
    lines.push('');
    lines.push(doc.outlineSummary);
    lines.push('');
  }

  if (doc.content) {
    lines.push(stripHtml(doc.content));
  }

  const text = lines.join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  saveAs(blob, `${sanitizeFileName(doc.title)}.txt`);
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

export function exportProposalToMarkdown(doc: ProposalDocument) {
  const lines: string[] = [];
  lines.push(`# ${doc.title}`);
  lines.push('');

  if (doc.customerName) {
    lines.push(`**Customer:** ${doc.customerName}`);
    lines.push('');
  }

  lines.push(`**Date:** ${new Date().toLocaleDateString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  if (doc.outlineSummary) {
    lines.push('## Executive Summary');
    lines.push('');
    lines.push(doc.outlineSummary);
    lines.push('');
  }

  if (doc.content) {
    const md = doc.content
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
      .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n')
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    lines.push(md);
  }

  const mdText = lines.join('\n');
  const blob = new Blob([mdText], { type: 'text/markdown;charset=utf-8' });
  saveAs(blob, `${sanitizeFileName(doc.title)}.md`);
}

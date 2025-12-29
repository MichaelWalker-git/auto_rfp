import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import { ProposalDocument } from '@auto-rfp/shared';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

function sanitizeFileName(name: string) {
  return (name || 'proposal')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function buildProposalDocx(proposalDoc: ProposalDocument) {
  const children: Paragraph[] = [];

  // Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: proposalDoc.proposalTitle || 'Proposal', bold: true })],
    }),
  );

  // Optional metadata
  const meta: string[] = [];
  if (proposalDoc.customerName) meta.push(`Customer: ${proposalDoc.customerName}`);
  if (proposalDoc.opportunityId) meta.push(`Opportunity ID: ${proposalDoc.opportunityId}`);

  if (meta.length) {
    children.push(new Paragraph({ text: '' }));
    meta.forEach((line) => children.push(new Paragraph({ text: line })));
  }

  // Outline summary
  if (proposalDoc.outlineSummary) {
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Executive Summary' }));
    children.push(new Paragraph({ text: proposalDoc.outlineSummary }));
  }

  // Sections + subsections
  proposalDoc.sections.forEach((section, sIdx) => {
    children.push(new Paragraph({ text: '' }));
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: `${sIdx + 1}. ${section.title || 'Untitled Section'}`, bold: true })],
      }),
    );

    if (section.summary) children.push(new Paragraph({ text: section.summary }));

    section.subsections.forEach((sub, subIdx) => {
      children.push(new Paragraph({ text: '' }));
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({
            text: `${sIdx + 1}.${subIdx + 1} ${sub.title || 'Untitled Subsection'}`,
            bold: true
          })],
        }),
      );

      // preserve line breaks
      (sub.content || '').split(/\r?\n/).forEach((line) => children.push(new Paragraph({ text: line })));
    });
  });

  return new Document({ sections: [{ children }] });
}

export async function exportProposalToDocx(proposalDoc: ProposalDocument) {
  const doc = buildProposalDocx(proposalDoc);
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${sanitizeFileName(proposalDoc.proposalTitle)}.docx`);
}

export async function exportProposalToPdf(doc: {
  proposalTitle?: string | null;
  summary?: string | null;
  sections: {
    title?: string | null;
    summary?: string | null;
    subsections?: { title?: string | null; content?: string | null }[]
  }[];
}) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 48;
  const lineHeight = 14;
  const titleSize = 18;
  const h2Size = 14;
  const textSize = 11;

  const wrapText = (text: string, maxWidth: number, f: any, size: number) => {
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

  const safeName = (doc.proposalTitle || 'proposal')
    .toString()
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-');

  let page = pdfDoc.addPage();
  let { width, height } = page.getSize();
  let x = margin;
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
    page.drawText(text, {
      x,
      y,
      size,
      font: bold ? fontBold : font,
      color,
    });
    y -= lineHeight;
  };

  const drawParagraph = (text: string, size = textSize, bold = false) => {
    const maxWidth = width - margin * 2;
    const lines = wrapText(text || '', maxWidth, bold ? fontBold : font, size);
    for (const line of lines) drawLine(line, size, bold);
    y -= 6;
  };

  // Title
  drawParagraph(doc.proposalTitle || 'Proposal', titleSize, true);

  // Summary
  if (doc.summary) {
    drawLine('Summary', h2Size, true, rgb(0.1, 0.1, 0.1));
    drawParagraph(doc.summary, textSize, false);
  }

  // Sections
  for (const s of doc.sections || []) {
    const sectionTitle = s.title || 'Section';
    drawLine(sectionTitle, h2Size, true, rgb(0.1, 0.1, 0.1));

    if (s.summary) drawParagraph(s.summary, textSize, false);

    const subs = s.subsections || [];
    for (const sub of subs) {
      if (sub.title) drawParagraph(sub.title, 12, true);
      if (sub.content) drawParagraph(sub.content, textSize, false);
    }

    y -= 8;
  }

  const bytes = await pdfDoc.save();
  //@ts-ignore
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 2000);
}


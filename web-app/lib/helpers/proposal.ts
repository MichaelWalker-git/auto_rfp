import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver'
import { ProposalDocument } from '@auto-rfp/shared';

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

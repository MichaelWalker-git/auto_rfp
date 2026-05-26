import type { ContentLibraryItem } from '@auto-rfp/core';

// ─── Export Types ───

export interface ContentLibraryExportItem {
  question: string;
  answer: string;
  category: string;
  tags: string[];
  description?: string;
  approvalStatus: 'DRAFT' | 'APPROVED' | 'DEPRECATED';
}

export interface ContentLibraryExportData {
  exportVersion: string;
  exportedAt: string;
  itemCount: number;
  items: ContentLibraryExportItem[];
}

// ─── Transform Items ───

/**
 * Transform ContentLibraryItem to export format (strips internal fields).
 */
export const toExportItem = (item: ContentLibraryItem): ContentLibraryExportItem => ({
  question: item.question,
  answer: item.answer,
  category: item.category,
  tags: item.tags ?? [],
  description: item.description,
  approvalStatus: item.approvalStatus,
});

// ─── CSV Export ───

/**
 * Export content library items to CSV format.
 * Columns: Question, Answer, Category, Tags, Status, Description
 */
export const exportToCsv = (items: ContentLibraryItem[], fileName = 'qa-library'): void => {
  const exportItems = items.map(toExportItem);

  const headers = ['Question', 'Answer', 'Category', 'Tags', 'Status', 'Description'];
  const rows = exportItems.map((item) => [
    item.question,
    item.answer,
    item.category,
    item.tags.join(', '),
    item.approvalStatus,
    item.description ?? '',
  ]);

  const csvContent = [headers, ...rows]
    .map((row) =>
      row
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(','),
    )
    .join('\n');

  downloadFile(csvContent, `${fileName}.csv`, 'text/csv;charset=utf-8;');
};

// ─── JSON Export ───

/**
 * Export content library items to JSON format (import-ready).
 */
export const exportToJson = (items: ContentLibraryItem[], fileName = 'qa-library'): void => {
  const exportData: ContentLibraryExportData = {
    exportVersion: '1.0',
    exportedAt: new Date().toISOString(),
    itemCount: items.length,
    items: items.map(toExportItem),
  };

  const jsonContent = JSON.stringify(exportData, null, 2);
  downloadFile(jsonContent, `${fileName}.json`, 'application/json;charset=utf-8;');
};

// ─── DOCX Export ───

/**
 * Export content library items to DOCX format, grouped by category.
 */
export const exportToDocx = async (items: ContentLibraryItem[], fileName = 'qa-library'): Promise<void> => {
  const docx = await import('docx');
  const { saveAs } = await import('file-saver');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;

  const children: InstanceType<typeof Paragraph>[] = [];

  // Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: 'Q&A Library Export', bold: true, size: 32 })],
    }),
  );

  // Export date
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({
          text: `Exported: ${new Date().toLocaleDateString()}`,
          italics: true,
          color: '666666',
        }),
      ],
    }),
  );

  // Group items by category
  const itemsByCategory = new Map<string, ContentLibraryItem[]>();
  for (const item of items) {
    const list = itemsByCategory.get(item.category) ?? [];
    list.push(item);
    itemsByCategory.set(item.category, list);
  }

  // Sort categories alphabetically
  const sortedCategories = Array.from(itemsByCategory.keys()).sort();

  for (const category of sortedCategories) {
    const categoryItems = itemsByCategory.get(category) ?? [];

    // Category heading
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
        children: [new TextRun({ text: category, bold: true })],
      }),
    );

    for (const item of categoryItems) {
      // Question (bold)
      children.push(
        new Paragraph({
          spacing: { before: 240, after: 120 },
          children: [new TextRun({ text: item.question, bold: true })],
        }),
      );

      // Answer
      children.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({
              text: item.answer || '(No answer)',
              italics: !item.answer,
              color: item.answer ? '333333' : '999999',
            }),
          ],
        }),
      );

      // Tags (if any)
      if (item.tags && item.tags.length > 0) {
        children.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: 'Tags: ', italics: true, color: '666666' }),
              new TextRun({ text: item.tags.join(', '), italics: true, color: '666666' }),
            ],
          }),
        );
      }

      // Status badge
      children.push(
        new Paragraph({
          spacing: { after: 240 },
          children: [
            new TextRun({ text: 'Status: ', italics: true, color: '666666' }),
            new TextRun({
              text: item.approvalStatus,
              italics: true,
              color: item.approvalStatus === 'APPROVED' ? '22c55e' : item.approvalStatus === 'DEPRECATED' ? 'ef4444' : '666666',
            }),
          ],
        }),
      );
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBlob(doc);
  saveAs(buffer, `${fileName}.docx`);
};

// ─── Helper ───

const downloadFile = (content: string, fileName: string, mimeType: string): void => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

import type { RFPDocumentItem } from '@auto-rfp/core';

/**
 * Check if a questionnaire document is XLSX format (uses spreadsheet editor)
 */
export const isXlsxQuestionnaire = (doc: RFPDocumentItem): boolean => {
  if (doc.documentType !== 'QUESTIONNAIRE') return false;

  const fileName = doc.originalFileName?.toLowerCase() || doc.fileKey?.toLowerCase() || '';
  return fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
};

/**
 * Check if a questionnaire document is HTML format (uses standard editor)
 */
export const isHtmlQuestionnaire = (doc: RFPDocumentItem): boolean => {
  if (doc.documentType !== 'QUESTIONNAIRE') return false;

  // HTML questionnaires have content or htmlContentKey
  return !!doc.content || !!doc.htmlContentKey;
};

/**
 * Get the appropriate editor type for a document
 */
export const getEditorType = (doc: RFPDocumentItem): 'xlsx' | 'html' | 'standard' => {
  if (doc.documentType === 'QUESTIONNAIRE') {
    return isXlsxQuestionnaire(doc) ? 'xlsx' : 'html';
  }
  return 'standard';
};

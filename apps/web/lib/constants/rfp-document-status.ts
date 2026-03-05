/**
 * RFP Document Generation Status Constants
 *
 * Documents go through these states during AI generation:
 * - GENERATING: AI is currently generating the document
 * - FAILED: Generation failed with an error
 * - null/undefined: Generation completed successfully (document is ready)
 */

export const RFP_DOCUMENT_STATUS = {
  GENERATING: 'GENERATING',
  FAILED: 'FAILED',
  READY: null,
} as const;

export type RFPDocumentStatus = typeof RFP_DOCUMENT_STATUS[keyof typeof RFP_DOCUMENT_STATUS];

/**
 * Check if a document is currently being generated
 */
export const isDocumentGenerating = (status?: string | null): boolean => {
  return status === RFP_DOCUMENT_STATUS.GENERATING;
};

/**
 * Check if a document generation failed
 */
export const isDocumentFailed = (status?: string | null): boolean => {
  return status === RFP_DOCUMENT_STATUS.FAILED;
};

/**
 * Check if a document is ready for editing (generation completed successfully)
 */
export const isDocumentReady = (status?: string | null): boolean => {
  return !status || (!isDocumentGenerating(status) && !isDocumentFailed(status));
};

/**
 * Check if a document can be edited (ready state)
 */
export const canEditDocument = (status?: string | null): boolean => {
  return isDocumentReady(status);
};

/**
 * Check if a document can be saved (ready or failed, but not generating)
 */
export const canSaveDocument = (status?: string | null): boolean => {
  return !isDocumentGenerating(status);
};

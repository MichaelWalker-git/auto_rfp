import { DocumentPromptTypeSchema } from '@auto-rfp/core';
import { readDocumentPrompt } from './prompt';

export interface DocumentPromptFragments {
  /** SYSTEM-scope guidance fragment override, or null when the hardcoded default applies. */
  guidance: string | null;
  /** USER-scope task fragment override, or null when the hardcoded default applies. */
  task: string | null;
}

const NO_OVERRIDES: DocumentPromptFragments = { guidance: null, task: null };

/**
 * Fetch org-level prompt fragment overrides for a document type.
 *
 * NEVER throws — document generation must not fail because of prompt management.
 * Unknown/custom document types and any read error resolve to nulls, so the
 * hardcoded defaults in document-prompts.ts apply.
 */
export const resolveDocumentPromptFragments = async (
  orgId: string,
  documentType: string,
): Promise<DocumentPromptFragments> => {
  const { success, data } = DocumentPromptTypeSchema.safeParse(documentType);
  if (!success) return NO_OVERRIDES;

  try {
    const [sys, usr] = await Promise.all([
      readDocumentPrompt(orgId, 'SYSTEM', data),
      readDocumentPrompt(orgId, 'USER', data),
    ]);
    return {
      guidance: sys?.prompt?.trim() || null,
      task: usr?.prompt?.trim() || null,
    };
  } catch (err) {
    console.warn(
      `[document-prompts] Override read failed for ${documentType}, using defaults:`,
      (err as Error).message,
    );
    return NO_OVERRIDES;
  }
};

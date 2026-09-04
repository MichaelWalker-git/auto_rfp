import { z } from 'zod';

/**
 * Manifest entry for one solicitation document in a `SUMMARIZED` bundle:
 * a short summary plus its section headings, used to build the document
 * manifest primer and to let `fetch_solicitation_section` resolve a
 * `documentName` back to the right file.
 */
export const DocSummarySchema = z.object({
  name: z.string().min(1),
  chars: z.number().int().min(0),
  summary: z.string().min(1),
  sections: z.array(z.string()),
});

export type DocSummary = z.infer<typeof DocSummarySchema>;

/** Manifest entry for one solicitation document in a `FULL` bundle. */
export const SolicitationDocumentRefSchema = z.object({
  name: z.string().min(1),
  chars: z.number().int().min(0),
});

export type SolicitationDocumentRef = z.infer<typeof SolicitationDocumentRefSchema>;

/**
 * Routing decision for how the Solution Plan sees the merged solicitation
 * text: full text (small/medium RFPs, prompt-cached) or per-document
 * summaries plus an on-demand fetch tool (huge RFPs), so nothing is
 * silently dropped either way.
 */
export const SolicitationBundleSchema = z.discriminatedUnion('strategy', [
  z.object({
    strategy: z.literal('FULL'),
    text: z.string(),
    documents: z.array(SolicitationDocumentRefSchema),
  }),
  z.object({
    strategy: z.literal('SUMMARIZED'),
    summaries: z.array(DocSummarySchema),
    totalChars: z.number().int().min(0),
  }),
]);

export type SolicitationBundle = z.infer<typeof SolicitationBundleSchema>;

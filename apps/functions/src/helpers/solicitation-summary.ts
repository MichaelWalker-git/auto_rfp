/**
 * solicitation-summary.ts
 *
 * Per-document summaries for the Solution Plan's `SUMMARIZED` solicitation
 * strategy (see `solicitation-loader.ts`): a short purpose statement plus
 * the document's section headings, so the Tech Lead can decide which
 * document to pull via `fetch_solicitation_section` without ever seeing the
 * raw text up front.
 */

import { z } from 'zod';
import type { QuestionFileItem } from '@auto-rfp/core';

import { invokeClaudeJson, truncateText } from './executive-opportunity-brief';
import { requireEnv } from './env';

/** Cheap/fast model preferred for summarization; falls back to the shared Bedrock model. */
const resolveSummaryModelId = (): string =>
  process.env.SOLUTION_PLAN_GRILLER_MODEL_ID || requireEnv('BEDROCK_MODEL_ID');

/** Enough text to see the whole outline of most solicitation documents without paying for the full body. */
const SUMMARY_INPUT_CHAR_CAP = 40_000;
const SUMMARY_MAX_TOKENS = 800;

const SolicitationDocSummarySchema = z.object({
  summary: z.string().min(1),
  sections: z.array(z.string()),
});

export type SolicitationDocSummary = z.infer<typeof SolicitationDocSummarySchema>;

const buildSystemPrompt = (): string =>
  `You summarize solicitation documents for a government-contractor proposal team. Given one document's extracted text, respond with ONLY a JSON object, no markdown fences or commentary:
{"summary": "<3-5 sentences on the document's purpose and what it covers>", "sections": ["<section heading 1>", "<section heading 2>", ...]}

RULES:
- "summary" must be 3-5 sentences, factual, no speculation.
- "sections" lists the document's actual section/heading titles in order, as they appear in the text. If no clear headings exist, infer the major topical divisions instead.`;

const buildUserPrompt = (fileName: string, text: string): string =>
  `Document: ${fileName}\n\n${truncateText(text, SUMMARY_INPUT_CHAR_CAP)}\n\nRespond with the JSON object only.`;

/**
 * Summarize one solicitation document. Pure Bedrock call — callers decide
 * whether to use a cached `QuestionFileItem.summary` first and whether to
 * persist the result back.
 */
export const summarizeSolicitationDocument = async (
  orgId: string,
  file: Pick<QuestionFileItem, 'originalFileName' | 'questionFileId'>,
  text: string,
): Promise<SolicitationDocSummary> => {
  const fileName = file.originalFileName || file.questionFileId;
  return invokeClaudeJson({
    modelId: resolveSummaryModelId(),
    orgId,
    system: buildSystemPrompt(),
    user: buildUserPrompt(fileName, text),
    outputSchema: SolicitationDocSummarySchema,
    maxTokens: SUMMARY_MAX_TOKENS,
    temperature: 0.2,
  });
};

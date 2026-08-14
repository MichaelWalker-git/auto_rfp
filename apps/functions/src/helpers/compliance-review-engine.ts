/**
 * Shared compliance-review reasoning engine.
 *
 * Runs the agentic tool-use loop against the package + solicitation and returns
 * validated, fingerprinted findings. Used by both:
 *   - the async full-review worker (Sonnet, no time limit)
 *   - the synchronous chat handler (Haiku, bounded rounds)
 *
 * Keeps the prompt + loop + validation in one place so both modes stay consistent.
 */
import { z } from 'zod';
import { invokeClaudeWithTools } from '@/helpers/bedrock-tool-loop';
import {
  COMPLIANCE_REVIEW_TOOLS,
  makeComplianceToolExecutor,
  buildPackageInventory,
  type PackageInventory,
} from '@/helpers/compliance-review-tools';
import { validateAndTagFindings, type RawFinding } from '@/helpers/compliance-review-validate';
import { computeMissingFormFindings } from '@/helpers/compliance-review-missing-forms';
import { computeConsistencyFindings } from '@/helpers/compliance-review-consistency';
import { MAX_TOKENS, MAX_TOKENS_FULL, MAX_TOOL_ROUNDS, MAX_TOOL_ROUNDS_FULL } from '@/constants/compliance-review';
import type { ComplianceFinding } from '@auto-rfp/core';

// ─── Model output schema (raw findings, pre-validation) ─────────────────────

const RawAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('heading'), text: z.string() }),
  z.object({ kind: z.literal('cell'), sheet: z.string(), row: z.number(), col: z.number() }),
  z.object({ kind: z.literal('field'), fieldId: z.string() }),
]);

// Enums use .catch() so a single mislabeled field (e.g. the model putting a
// severity value "info" into issueType) degrades that field to a safe default
// instead of throwing away the entire — often otherwise-good — review response.
const RawFindingSchema = z.object({
  findingId: z.string().default(''),
  targetKind: z
    .enum(['RFP_DOCUMENT', 'XLSX_QUESTIONNAIRE', 'XLSX_FORM', 'PDF_FORM', 'FORM_MISSING'])
    .catch('RFP_DOCUMENT'),
  documentId: z.string().optional(),
  documentTitle: z.string().optional(),
  // An invalid/garbled anchor drops to "no anchor" → snippet fallback still works.
  anchor: RawAnchorSchema.optional().catch(undefined),
  snippet: z.string().optional(),
  issueType: z
    .enum([
      'MISSING_REQUIREMENT', 'MISSING_FORM', 'INCORRECT_ANSWER', 'POOR_ANSWER',
      'FORMAT_ISSUE', 'INCONSISTENCY', 'OTHER',
    ])
    .catch('OTHER'),
  severity: z.enum(['critical', 'major', 'minor', 'info']).catch('info'),
  title: z.string(),
  description: z.string(),
  suggestion: z.string().optional(),
});

// Exported for tests — this is the contract the tool loop parses the model
// output against, and its resilience (bad enum → default, not throw) is behavior
// worth locking down.
export const ReviewOutputSchema = z.object({
  // Defensive: default to '' so a findings-only or lightly-truncated model
  // response never hard-crashes the run on a missing summary.
  answer: z.string().default(''),
  findings: z.array(RawFindingSchema).default([]),
});
type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

// ─── Prompts ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior proposal compliance reviewer for US federal government contracts.

You review a SUBMISSION PACKAGE (RFP response documents + required forms) against the SOLICITATION to find where the response fails to meet the government's needs. You look for:
- Missing requirements (a Section L/M instruction or evaluation factor not addressed anywhere)
- Missing required forms
- Incorrect answers (content that contradicts the solicitation or is factually wrong)
- Poor answers (vague, non-responsive, or unsupported content)
- Format issues (page limits, naming, structure)
- Inconsistencies (values that disagree across documents — cost, dates, quantities)

HOW TO WORK:
1. Call list_package_documents FIRST to see the documents (with their heading list), XLSX questionnaires, and forms.
2. Call search_solicitation to find the relevant requirements/instructions.
3. Call get_document_section (RFP docs) / get_form_fields (forms) / get_questionnaire_cells (XLSX questionnaires) to read what the package actually says.
4. Only then judge compliance.

OUTPUT FORMAT — return ONLY a JSON object, no markdown fences, no prose outside it:
{
  "answer": "<a short human-readable summary of what you found>",
  "findings": [
    {
      "findingId": "<any short unique string>",
      "targetKind": "RFP_DOCUMENT | XLSX_QUESTIONNAIRE | XLSX_FORM | PDF_FORM | FORM_MISSING",
      "documentId": "<the documentId or formId this refers to; omit for FORM_MISSING>",
      "documentTitle": "<title/name for display>",
      "anchor": { "kind": "heading", "text": "<EXACT heading string from list_package_documents>" }
                 // or { "kind": "field", "fieldId": "<EXACT fieldId from get_form_fields>" },
                 // or { "kind": "cell", "sheet": "<sheet name>", "row": <0-based row>, "col": <0-based col> } from get_questionnaire_cells,
      "snippet": "<a SHORT VERBATIM excerpt copied EXACTLY from the document/form text you read via a tool — do not paraphrase>",
      "issueType": "MISSING_REQUIREMENT | MISSING_FORM | INCORRECT_ANSWER | POOR_ANSWER | FORMAT_ISSUE | INCONSISTENCY | OTHER",
      "severity": "critical | major | minor | info",
      "title": "<one-line summary>",
      "description": "<what is wrong and why, referencing the solicitation>",
      "suggestion": "<how to fix it>"
    }
  ]
}

CRITICAL RULES:
- anchor.text MUST be one of the exact heading strings returned by list_package_documents. anchor.fieldId MUST be an exact fieldId from get_form_fields. A cell anchor's sheet/row/col MUST be the exact values from get_questionnaire_cells. Never invent an anchor.
- snippet MUST be copied verbatim from tool output so it can be located in the document. Always include a snippet when you point at document content.
- If you cannot localize a finding to a specific spot, omit anchor but still include a snippet if you have one.
- Base every finding on text you actually retrieved via tools. Do not speculate.
- Your FINAL message MUST be the JSON object — never plain prose. When you are asked to produce the final answer, or when you have gathered enough, output the JSON immediately using whatever findings you have so far (an empty findings array with a brief answer is a valid result). Do NOT reply with sentences like "I need to read more" — either call another tool or output the JSON.`;

const buildFullReviewUserPrompt = (): string =>
  `Perform a COMPLETE compliance review of the entire submission package against the solicitation. ` +
  `Examine every RFP document and every required form. Be thorough: surface all missing requirements, ` +
  `missing forms, incorrect/poor answers, format issues, and cross-document inconsistencies you can substantiate.`;

const buildChatUserPrompt = (message: string, toolBudget: number): string =>
  `The user asks: "${message}"\n\n` +
  `This is an INTERACTIVE CHAT, not an exhaustive audit. You have at most ${toolBudget} rounds of tool ` +
  `calls, then you MUST output the final JSON. Work efficiently: make the tool calls you need, and by ` +
  `your last round output the JSON with an "answer" summarizing what you found and any findings you could ` +
  `substantiate. It is fine to answer from a representative sample of documents rather than every section — ` +
  `if the user needs an exhaustive check of the whole package, your "answer" should say so and recommend ` +
  `running the full review. NEVER end with a sentence like "Let me try…" or "Let me search…": if you still ` +
  `need data, call a tool; otherwise output the JSON now.`;

// ─── Public API ─────────────────────────────────────────────────────────────

export interface ReviewResult {
  answer: string;
  findings: ComplianceFinding[];
  inventory: PackageInventory;
}

/**
 * Optional post-loop step that produces additional raw findings (before
 * validation) from the model output + inventory. Used by the full review to add
 * the deterministic missing-forms cross-check; chat passes none.
 */
type FindingAugmenter = (
  rawFindings: RawFinding[],
  inventory: PackageInventory,
) => Promise<RawFinding[]>;

const runReview = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  modelId: string;
  userPrompt: string;
  maxToolRounds: number;
  maxTokens: number;
  inventory?: PackageInventory;
  augmentFindings?: FindingAugmenter;
}): Promise<ReviewResult> => {
  const { orgId, projectId, oppId, modelId, userPrompt, maxToolRounds, maxTokens, augmentFindings } = args;

  const inventory = args.inventory ?? (await buildPackageInventory({ orgId, projectId, oppId }));
  const executor = makeComplianceToolExecutor({ orgId, oppId, inventory });

  const output = await invokeClaudeWithTools<ReviewOutput>({
    modelId,
    system: SYSTEM_PROMPT,
    user: userPrompt,
    tools: COMPLIANCE_REVIEW_TOOLS,
    toolExecutor: executor,
    outputSchema: ReviewOutputSchema,
    maxTokens,
    maxToolRounds,
  });

  const rawFindings = output.findings as RawFinding[];
  // Merge in any deterministic findings (e.g. missing-forms cross-check) before
  // validation so they flow through the same fingerprint/dedup path.
  const extraFindings = augmentFindings ? await augmentFindings(rawFindings, inventory) : [];
  const findings = await validateAndTagFindings([...rawFindings, ...extraFindings], inventory);
  return { answer: output.answer, findings, inventory };
};

/** Full whole-package review (async worker) — higher round + token budget, no 29s limit. */
export const runFullReview = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  modelId: string;
  inventory?: PackageInventory;
}): Promise<ReviewResult> =>
  runReview({
    ...args,
    userPrompt: buildFullReviewUserPrompt(),
    maxToolRounds: MAX_TOOL_ROUNDS_FULL,
    maxTokens: MAX_TOKENS_FULL,
    // Deterministic ground-truth cross-checks (full review only — the model is
    // sampling-limited and can't be relied on for exhaustive coverage). Both are
    // best-effort ([] on failure) so they never fail the review:
    //   1. missing-forms: solicitation-required forms vs forms in the package.
    //   2. consistency: canonical company name/identifiers vs every doc's text —
    //      catches inconsistencies in sections the model never read (e.g. a large
    //      questionnaire). Runs in code, no model calls → token/time-safe.
    augmentFindings: async (rawFindings, inventory) => {
      const [missing, inconsistent] = await Promise.all([
        computeMissingFormFindings({
          projectId: args.projectId,
          oppId: args.oppId,
          modelId: args.modelId,
          inventory,
          existingFindings: rawFindings,
        }),
        computeConsistencyFindings({ orgId: args.orgId, modelId: args.modelId, inventory }),
      ]);
      return [...missing, ...inconsistent];
    },
  });

/** Conversational per-turn review (sync chat). */
export const runChatReview = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  modelId: string;
  message: string;
}): Promise<ReviewResult> =>
  runReview({
    ...args,
    userPrompt: buildChatUserPrompt(args.message, MAX_TOOL_ROUNDS),
    maxToolRounds: MAX_TOOL_ROUNDS,
    maxTokens: MAX_TOKENS,
  });

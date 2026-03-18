/**
 * Section-by-section document generation using independent AI conversations per section.
 *
 * For template-based document generation, the template is split into sections
 * (based on <h2> headings), and each section is generated independently with
 * full tool access. This approach:
 *
 *   1. Prevents context bloat — each section gets a focused prompt
 *   2. Enables parallel generation — sections can be generated concurrently
 *   3. Provides per-section tool access — AI can query DB, KB, past performance per section
 *   4. Preserves template structure — images, macros are maintained
 *   5. Allows section-specific guidance — each section gets tailored instructions
 *
 * Flow:
 *   1. Template HTML is parsed into sections (via template-section-parser.ts)
 *   2. Each section is sent to AI with:
 *      - A section-specific system prompt (document type guidance + section focus)
 *      - The full solicitation + Q&A + enrichment context
 *      - Template content for that section (boilerplate, images, macros)
 *      - Full tool access (search_past_performance, search_knowledge_base, etc.)
 *   3. AI generates HTML for each section with tool-use loop
 *   4. Generated sections are merged back into the template structure
 */

import { invokeModel } from '@/helpers/bedrock-http-client';
import { DOCUMENT_TOOLS, executeDocumentTool } from '@/helpers/document-tools';
import type { QaPair } from '@/types/document-generation';
import type { ToolResult } from '@/types/tool';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocumentSection {
  title: string;
  description?: string;
  /** Guidance injected into the per-section prompt */
  guidance?: string;
  /** Original template HTML content for this section (boilerplate, images, resolved macros) */
  templateContent?: string;
}

export interface GenerateSectionBySection {
  modelId: string;
  systemPrompt: string;
  /** Initial user prompt with solicitation, Q&A, and enrichment context */
  initialUserPrompt: string;
  sections: DocumentSection[];
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  qaPairs: QaPair[];
  maxTokensPerSection?: number;
  temperature?: number;
  maxToolRoundsPerSection?: number;
}

/** Result of generating a single section */
export interface SectionGenerationResult {
  sectionIndex: number;
  title: string;
  html: string;
  toolRoundsUsed: number;
  durationMs: number;
}

type ContentBlock = {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
};

type Message = {
  role: string;
  content: unknown;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const extractText = (content: ContentBlock[]): string =>
  content
    .filter(c => c.type === 'text')
    .map(c => c.text ?? '')
    .join('\n')
    .trim();

/**
 * Execute a tool-use round: process all tool_use blocks from the assistant response,
 * execute the tools, and append results to the conversation.
 */
const runToolRound = async (
  messages: Message[],
  content: ContentBlock[],
  toolExecutorArgs: Omit<Parameters<typeof executeDocumentTool>[0], 'toolName' | 'toolInput' | 'toolUseId'>,
): Promise<void> => {
  const toolUseBlocks = content.filter(c => c.type === 'tool_use');
  messages.push({ role: 'assistant', content });

  const toolResults: ToolResult[] = await Promise.all(
    toolUseBlocks.map(block =>
      executeDocumentTool({
        ...toolExecutorArgs,
        toolName: block.name ?? '',
        toolInput: (block.input ?? {}) as Record<string, unknown>,
        toolUseId: block.id ?? '',
      }),
    ),
  );

  messages.push({
    role: 'user',
    content: toolResults.map(r => ({
      type: 'tool_result',
      tool_use_id: r.tool_use_id,
      content: r.content,
    })),
  });
};

/**
 * Build the per-section user prompt that includes:
 * - Full context (solicitation, Q&A, enrichment)
 * - Continuity hints (previously generated section titles)
 * - Template content for this section
 * - Section-specific generation instructions
 */
const buildSectionPrompt = (
  initialUserPrompt: string,
  section: DocumentSection,
  sectionIndex: number,
  totalSections: number,
  completedSectionTitles: string[],
): string => {
  const isFirst = sectionIndex === 0;
  const isLast = sectionIndex === totalSections - 1;

  // Build continuity hint from previously completed sections (titles only, not content)
  const continuityHint = completedSectionTitles.length > 0
    ? `\n\nPreviously generated sections (DO NOT repeat their content): ${completedSectionTitles.map(s => `"${s}"`).join(', ')}.`
    : '';

  // Build template content instruction if the section has original template content
  const templateContentHint = section.templateContent
    ? `\n\nTEMPLATE CONTENT FOR THIS SECTION:
The template contains the following existing content for this section. You MUST:
- PRESERVE all <img> tags exactly as-is (especially those with src="s3key:..." or data-s3-key="...")
- PRESERVE all pre-filled values (company names, dates, solicitation numbers, etc.) — these are real data
- ONLY replace text that is clearly a placeholder: [CONTENT: ...], [placeholder], [Your ...], or similar bracketed markers
- KEEP the same inline styles from the template — do NOT add borders, colors, or decorations not in the template
- EXPAND placeholder content with real, detailed, substantive content

Template content:
${section.templateContent}`
    : '';

  // Section position context
  const positionHint = isFirst
    ? 'This is the FIRST section of the document — set the tone and establish the narrative.'
    : isLast
      ? 'This is the FINAL section — include a professional closing statement at the end.'
      : `This is section ${sectionIndex + 1} of ${totalSections}.`;

  return `${initialUserPrompt}${continuityHint}

---

Generate ONLY the "${section.title}" section of this document.
${positionHint}
${section.description ? `Focus on: ${section.description}.` : ''}
${section.guidance ? `Additional guidance: ${section.guidance}` : ''}
${templateContentHint}

IMPORTANT OUTPUT RULES:
- Return ONLY the HTML for this section, starting with <h2>${section.title}</h2>
- Do NOT include the document title (<h1>)
- Do NOT repeat content from other sections
- Do NOT include any text outside the HTML
- Use the same inline styles as the template — do NOT add borders or decorations not in the template
- Preserve all <img> tags from the template exactly as-is
- Replace all \\n with actual newlines in the HTML output
- Generate COMPLETE, DETAILED content — minimum 3-5 paragraphs per section
- Use tools (search_past_performance, search_knowledge_base, get_qa_answers, etc.) to gather specific data for this section`;
};

// ─── Single Section Generator ─────────────────────────────────────────────────

/**
 * Generate a single section using an independent AI conversation with tool access.
 *
 * Each section gets:
 * - Its own fresh conversation (no context bleed from other sections)
 * - Full solicitation + Q&A + enrichment context
 * - Section-specific instructions and template content
 * - Up to maxToolRounds of tool-use iterations
 *
 * @returns The generated HTML fragment for this section, or empty string on failure
 */
const generateSingleSection = async (args: {
  modelId: string;
  systemPrompt: string;
  sectionPrompt: string;
  section: DocumentSection;
  toolExecutorBase: Omit<Parameters<typeof executeDocumentTool>[0], 'toolName' | 'toolInput' | 'toolUseId'>;
  maxTokensPerSection: number;
  temperature: number;
  maxToolRoundsPerSection: number;
}): Promise<{ html: string; toolRoundsUsed: number }> => {
  const {
    modelId,
    systemPrompt,
    sectionPrompt,
    section,
    toolExecutorBase,
    maxTokensPerSection,
    temperature,
    maxToolRoundsPerSection,
  } = args;

  // Fresh conversation for this section
  const messages: Message[] = [
    { role: 'user', content: [{ type: 'text', text: sectionPrompt }] },
  ];

  let sectionHtml = '';
  let toolRounds = 0;

  while (toolRounds <= maxToolRoundsPerSection) {
    const isLastRound = toolRounds >= maxToolRoundsPerSection;

    const requestBody: Record<string, unknown> = {
      anthropic_version: 'bedrock-2023-05-31',
      system: [{ type: 'text', text: systemPrompt }],
      messages,
      max_tokens: maxTokensPerSection,
      temperature,
    };

    // Provide tools on all rounds except the last (force text output on last round)
    if (!isLastRound) {
      requestBody.tools = DOCUMENT_TOOLS;
    }

    const responseBody = await invokeModel(modelId, JSON.stringify(requestBody));
    const parsed = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as {
      stop_reason?: string;
      content?: ContentBlock[];
    };

    const stopReason = parsed.stop_reason ?? 'end_turn';
    const content: ContentBlock[] = parsed.content ?? [];

    // Handle tool use
    if (stopReason === 'tool_use' && !isLastRound) {
      const toolUseBlocks = content.filter(c => c.type === 'tool_use');
      console.log(`[section-gen] Section "${section.title}" round ${toolRounds + 1}: ${toolUseBlocks.length} tool call(s)`);
      await runToolRound(messages, content, toolExecutorBase);
      toolRounds++;
      continue;
    }

    // Extract text response
    sectionHtml = extractText(content);

    // If last round still returned tool_use, force a final text response
    if (!sectionHtml && stopReason === 'tool_use' && isLastRound) {
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: `Now write the HTML for the "${section.title}" section based on all the information gathered. Return ONLY HTML starting with <h2>${section.title}</h2>.` }],
      });

      const finalBody = {
        anthropic_version: 'bedrock-2023-05-31',
        system: [{ type: 'text', text: systemPrompt }],
        messages,
        max_tokens: maxTokensPerSection,
        temperature,
      };

      const finalResponse = await invokeModel(modelId, JSON.stringify(finalBody));
      const finalParsed = JSON.parse(new TextDecoder('utf-8').decode(finalResponse)) as { content?: ContentBlock[] };
      sectionHtml = extractText(finalParsed.content ?? []);
    }

    break;
  }

  return { html: sectionHtml, toolRoundsUsed: toolRounds };
};

// ─── Main: Section-by-Section Generator ───────────────────────────────────────

/**
 * Generate a document section-by-section, where each section gets its own
 * independent AI conversation with full tool access.
 *
 * Returns an array of HTML fragments (one per section) that should be stitched
 * together using `injectSectionsIntoTemplate()`.
 *
 * Each fragment is a complete HTML snippet starting with an <h2> heading.
 *
 * Sections are generated sequentially to maintain document coherence:
 * - Each section knows which sections came before it (by title)
 * - This prevents content duplication across sections
 * - Sequential generation also avoids overwhelming the Bedrock API with concurrent requests
 */
export const generateDocumentSectionBySectionHtml = async (
  args: GenerateSectionBySection,
): Promise<string[]> => {
  const {
    modelId,
    systemPrompt,
    initialUserPrompt,
    sections,
    orgId,
    projectId,
    opportunityId,
    documentId,
    qaPairs,
    maxTokensPerSection = 6000,
    temperature = 0.1,
    maxToolRoundsPerSection = 2,
  } = args;

  const toolExecutorBase = { orgId, projectId, opportunityId, documentId, qaPairs };

  const htmlFragments: string[] = [];
  const completedSectionTitles: string[] = [];
  const results: SectionGenerationResult[] = [];

  console.log(`[section-gen] Starting section-by-section generation: ${sections.length} sections`);

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const sectionStart = Date.now();

    // Build section-specific prompt
    const sectionPrompt = buildSectionPrompt(
      initialUserPrompt,
      section,
      i,
      sections.length,
      completedSectionTitles,
    );

    console.log(`[section-gen] Generating section ${i + 1}/${sections.length}: "${section.title}" (prompt: ${sectionPrompt.length} chars)`);

    try {
      const { html: rawHtml, toolRoundsUsed } = await generateSingleSection({
        modelId,
        systemPrompt,
        sectionPrompt,
        section,
        toolExecutorBase,
        maxTokensPerSection,
        temperature,
        maxToolRoundsPerSection,
      });

      const durationMs = Date.now() - sectionStart;

      if (rawHtml.trim()) {
        // Strip any JSON wrapper if model accidentally returned JSON
        const htmlMatch = rawHtml.match(/<h[1-6][\s\S]*$/i);
        // Replace literal \n escape sequences with real newlines
        const cleanHtml = (htmlMatch ? htmlMatch[0] : rawHtml)
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t');

        htmlFragments.push(cleanHtml);
        completedSectionTitles.push(section.title);

        results.push({
          sectionIndex: i,
          title: section.title,
          html: cleanHtml,
          toolRoundsUsed,
          durationMs,
        });

        console.log(`[section-gen] Section "${section.title}": ${cleanHtml.length} chars, ${toolRoundsUsed} tool rounds, ${durationMs}ms`);
      } else {
        console.warn(`[section-gen] Section "${section.title}": empty response, skipping`);
      }
    } catch (err) {
      const durationMs = Date.now() - sectionStart;
      console.error(`[section-gen] Section "${section.title}" failed after ${durationMs}ms:`, (err as Error)?.message);
      // Continue with remaining sections — don't fail the entire document for one section
    }
  }

  console.log(`[section-gen] Generation complete: ${htmlFragments.length}/${sections.length} sections generated`);

  return htmlFragments;
};

/**
 * Extract <h1> styling from template HTML.
 * Returns the style attribute value if found, otherwise returns a minimal default.
 */
export const extractH1StyleFromTemplate = (templateHtml: string): string => {
  const h1Match = templateHtml.match(/<h1([^>]*)>/i);
  if (h1Match) {
    const styleMatch = h1Match[1]?.match(/style="([^"]*)"/i);
    if (styleMatch?.[1]) {
      return styleMatch[1];
    }
  }
  // Minimal fallback — no hardcoded border
  return 'font-size:2em;font-weight:700;margin:0 0 0.5em';
};

/**
 * Build a document title HTML header from the document type and title.
 * Uses styling from the template if provided, otherwise uses minimal default.
 */
export const buildDocumentTitleHtml = (title: string, templateHtml?: string): string => {
  const style = templateHtml ? extractH1StyleFromTemplate(templateHtml) : 'font-size:2em;font-weight:700;margin:0 0 0.5em';
  return `<h1 style="${style}">${title}</h1>`;
};

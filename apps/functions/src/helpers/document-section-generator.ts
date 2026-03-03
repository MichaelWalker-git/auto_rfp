/**
 * Section-by-section document generation using a single persistent AI conversation.
 *
 * For large documents (Technical Proposal, Management Proposal, etc.), generating
 * the entire document in one shot often results in truncated or shallow content.
 *
 * This helper generates each major section in a separate AI turn within the SAME
 * conversation thread, so Claude retains full context of what was already written.
 * The sections are then stitched together into a single HTML document.
 *
 * Strategy:
 *   1. First turn: generate document title, executive overview, and first section
 *   2. Subsequent turns: "Continue with section N: [title]" — Claude builds on prior content
 *   3. Final turn: generate closing statement and wrap up
 *   4. Stitch all HTML fragments into one complete document
 */

import { invokeModel } from '@/helpers/bedrock-http-client';
import { DOCUMENT_TOOLS, executeDocumentTool } from '@/helpers/document-tools';
import type { QaPair } from '@/helpers/document-generation';
import type { ToolResult } from '@/types/tool';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocumentSection {
  title: string;
  description?: string;
  /** Guidance injected into the per-section prompt */
  guidance?: string;
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

// ─── Document types that benefit from section-by-section generation ───────────

/**
 * Document types where section-by-section generation produces better results.
 * These are large, multi-section documents where a single generation often truncates.
 */
export const SECTIONED_DOCUMENT_TYPES = new Set([
  'TECHNICAL_PROPOSAL',
  'MANAGEMENT_PROPOSAL',
  'MANAGEMENT_APPROACH',
  'PAST_PERFORMANCE',
  'RISK_MANAGEMENT',
  'QUALITY_MANAGEMENT',
  'COMPLIANCE_MATRIX',
  'APPENDICES',
]);

// ─── Section definitions for each document type ───────────────────────────────

export const DOCUMENT_SECTIONS: Record<string, DocumentSection[]> = {
  TECHNICAL_PROPOSAL: [
    { title: 'Understanding of the Requirement', description: 'Customer mission, current state, requirements analysis' },
    { title: 'Technical Approach', description: 'Problem → Solution → Benefit for each major requirement' },
    { title: 'Management Approach', description: 'Org structure, key personnel, communication plan' },
    { title: 'Staffing Plan', description: 'Labor categories, recruitment, retention' },
    { title: 'Transition & Phase-In Plan', description: 'Knowledge transfer, timeline, continuity' },
  ],
  MANAGEMENT_PROPOSAL: [
    { title: 'Program Management Approach', description: 'Methodology, governance, PMO structure' },
    { title: 'Organizational Structure', description: 'Org chart, roles, responsibilities' },
    { title: 'Key Personnel', description: 'Profiles, qualifications, certifications' },
    { title: 'Communication & Reporting', description: 'Meeting cadence, reporting, escalation' },
    { title: 'Risk Management', description: 'Top 5 risks with mitigations' },
    { title: 'Quality Management', description: 'QA/QC processes, metrics, continuous improvement' },
    { title: 'Security & Compliance', description: 'FISMA, FedRAMP, personnel security' },
  ],
  MANAGEMENT_APPROACH: [
    { title: 'Program Management Methodology', description: 'PMP, Agile, Hybrid approach' },
    { title: 'Organizational Structure & Key Personnel', description: 'Org chart, key roles' },
    { title: 'Communication & Reporting Plan', description: 'Meeting cadence, deliverables, escalation' },
    { title: 'Risk Management', description: 'Top risks with mitigations' },
    { title: 'Quality Assurance & Control', description: 'QA/QC processes, metrics, SLAs' },
  ],
  PAST_PERFORMANCE: [
    { title: 'Past Performance Overview', description: 'Summary of relevant experience and relevance matrix' },
    { title: 'Contract 1: Most Relevant Project', description: 'STAR format: situation, task, action, result' },
    { title: 'Contract 2: Second Most Relevant Project', description: 'STAR format: situation, task, action, result' },
    { title: 'Contract 3: Third Most Relevant Project', description: 'STAR format: situation, task, action, result' },
    { title: 'Relevance Summary', description: 'Cross-reference matrix mapping past work to current requirements' },
  ],
  RISK_MANAGEMENT: [
    { title: 'Risk Management Approach', description: 'Methodology, framework, roles, reporting cadence' },
    { title: 'Risk Assessment Matrix', description: 'Likelihood/impact scales, scoring methodology' },
    { title: 'Technical & Schedule Risks', description: 'Top technical and schedule risks with mitigations' },
    { title: 'Cost & Personnel Risks', description: 'Cost and staffing risks with mitigations' },
    { title: 'External & Government Risks', description: 'Regulatory, supply chain, and government-side risks' },
    { title: 'Risk Monitoring & Reporting', description: 'Risk register, dashboard, escalation procedures' },
  ],
  QUALITY_MANAGEMENT: [
    { title: 'Quality Management Philosophy & Framework', description: 'ISO 9001, CMMI, Six Sigma approach' },
    { title: 'Quality Assurance Plan', description: 'QA activities, roles, reporting, standards compliance' },
    { title: 'Quality Control Processes', description: 'QC checkpoints, peer reviews, defect tracking' },
    { title: 'Performance Metrics & KPIs', description: 'Key metrics, measurement methodology, thresholds' },
    { title: 'Continuous Improvement', description: 'Lessons learned, root cause analysis, process improvement' },
    { title: 'Customer Satisfaction Management', description: 'Feedback collection, surveys, escalation' },
  ],
  COMPLIANCE_MATRIX: [
    { title: 'Introduction', description: 'Purpose, how to use, reference to Section L and M' },
    { title: 'Section L Compliance Matrix', description: 'Instructions to offerors — requirement, compliance, location, notes' },
    { title: 'Section M Compliance Matrix', description: 'Evaluation criteria — factor, weight, location, discriminators, evidence' },
    { title: 'Technical Requirements Traceability', description: 'SOW/PWS requirements mapped to proposal sections' },
    { title: 'Deliverables Compliance', description: 'All required deliverables with format and submission confirmation' },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const extractText = (content: ContentBlock[]): string =>
  content
    .filter(c => c.type === 'text')
    .map(c => c.text ?? '')
    .join('\n')
    .trim();

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

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Generate a large document section-by-section in a single persistent conversation.
 *
 * Returns an array of HTML fragments (one per section) that should be stitched together.
 * Each fragment is a complete HTML snippet starting with an <h2> heading.
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

  // Each section is generated in its own independent conversation.
  // This prevents context bloat and duplication across sections.
  // The initialUserPrompt (solicitation + Q&A + enrichment) is included
  // in every section's first message so Claude has full context.
  const htmlFragments: string[] = [];
  // Track previously generated section titles for continuity hints
  const completedSections: string[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const isLast = i === sections.length - 1;

    // Build continuity hint from previously completed sections (titles only, not content)
    const continuityHint = completedSections.length > 0
      ? `\n\nPreviously generated sections (DO NOT repeat their content): ${completedSections.map(s => `"${s}"`).join(', ')}.`
      : '';

    // Each section gets its own fresh conversation with full context
    const sectionInstruction = `${initialUserPrompt}${continuityHint}

---

Generate ONLY the "${section.title}" section of this document.${section.description ? ` Focus on: ${section.description}.` : ''}${isLast ? ' This is the final section — include a professional closing statement at the end.' : ''}

IMPORTANT:
- Return ONLY the HTML for this section, starting with <h2>${section.title}</h2>
- Do NOT include the document title (<h1>)
- Do NOT repeat content from other sections
- Do NOT include any text outside the HTML
- Use proper HTML with inline styles (h2, h3, p, ul, li, table elements)
- Replace all \\n with actual newlines in the HTML output`;

    // Fresh conversation for each section
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: sectionInstruction }] },
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

      if (stopReason === 'tool_use' && !isLastRound) {
        console.log(`[section-gen] Section "${section.title}" round ${toolRounds + 1}: tool use`);
        await runToolRound(messages, content, toolExecutorBase);
        toolRounds++;
        continue;
      }

      sectionHtml = extractText(content);

      // If last round still returned tool_use, force a final text response
      if (!sectionHtml && stopReason === 'tool_use' && isLastRound) {
        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: [{ type: 'text', text: `Now write the HTML for the "${section.title}" section based on the information gathered.` }],
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
        // Add the final response to conversation for continuity
        messages.push({ role: 'assistant', content: finalParsed.content ?? [] });
      } else {
        // Add assistant response to conversation for continuity
        messages.push({ role: 'assistant', content });
      }

      break;
    }

    if (sectionHtml.trim()) {
      // Strip any JSON wrapper if model accidentally returned JSON
      const htmlMatch = sectionHtml.match(/<h[1-6][\s\S]*$/i);
      // Replace literal \n escape sequences with real newlines
      const cleanHtml = (htmlMatch ? htmlMatch[0] : sectionHtml)
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t');
      htmlFragments.push(cleanHtml);
      completedSections.push(section.title);
      console.log(`[section-gen] Section "${section.title}": ${cleanHtml.length} chars`);
    } else {
      console.warn(`[section-gen] Section "${section.title}": empty response, skipping`);
    }
  }

  return htmlFragments;
};

/**
 * Build a document title HTML header from the document type and title.
 */
export const buildDocumentTitleHtml = (title: string): string =>
  `<h1 style="font-size:2em;font-weight:700;margin:0 0 0.5em;color:#1a1a2e;border-bottom:3px solid #4f46e5;padding-bottom:0.3em">${title}</h1>`;

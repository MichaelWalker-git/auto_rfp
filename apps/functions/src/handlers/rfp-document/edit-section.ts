/**
 * POST /rfp-document/edit-section
 *
 * AI-powered section editing endpoint. Accepts a document section's HTML and
 * user instructions, then uses Bedrock with tools to produce an updated section.
 *
 * This is a synchronous endpoint (no SQS queue) since it edits a single section,
 * not a full document. Timeout is set to 60s in the route definition.
 */
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { getRFPDocument } from '@/helpers/rfp-document';
import { DOCUMENT_TOOLS, executeDocumentTool } from '@/helpers/document-tools';
import { invokeModel } from '@/helpers/bedrock-http-client';
import type { QaPair } from '@/helpers/document-generation';
import { loadQaPairs, loadSolicitation } from '@/helpers/document-generation';
import { gatherAllContext } from '@/helpers/document-context';
import { BEDROCK_MODEL_ID, TEMPERATURE } from '@/constants/document-generation';
import { saveChatMessages } from '@/helpers/ai-chat';

// ─── Retry helper for transient Bedrock errors (503 Service Unavailable) ───

const invokeModelWithRetry = async (
  modelId: string,
  body: string,
  maxRetries = 2,
): Promise<Uint8Array> => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await invokeModel(modelId, body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const isRetryable = msg.includes('503') || msg.includes('Service Unavailable') || msg.includes('ThrottlingException');
      if (!isRetryable || attempt >= maxRetries) throw err;
      const delayMs = 1000 * (attempt + 1);
      console.warn(`[edit-section] Bedrock returned retryable error, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries}): ${msg}`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Unreachable');
};

// ─── Input Schema ───

const EditSectionInputSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentId: z.string().min(1),
  /** The heading text of the section being edited */
  sectionTitle: z.string().min(1),
  /** The current HTML content of the section */
  currentSectionHtml: z.string(),
  /** User's instruction/tip for the AI */
  instruction: z.string().min(1).max(2000),
  /** Optional: full document HTML for context (truncated if too long) */
  fullDocumentContext: z.string().optional(),
});

// ─── Constants ───

const MAX_TOOL_ROUNDS = 1;
const MAX_TOKENS = 8000;
const MAX_CONTEXT_CHARS = 6000;

// ─── Build Section Edit Prompt ───

const buildSectionEditSystemPrompt = (sectionTitle: string): string => `You are a senior proposal writer and capture manager with 20+ years of experience winning US federal government contracts.

You are editing a SINGLE SECTION of an RFP proposal document. The section is titled "${sectionTitle}".

CRITICAL OUTPUT FORMAT:
- Return ONLY the updated HTML for this section
- Start with the section heading (e.g., <h2>${sectionTitle}</h2>)
- Do NOT return JSON — return raw HTML only
- Do NOT include any text outside the HTML
- Do NOT wrap the output in \`\`\`html fences
- Do NOT include the full document — only the edited section

EDITING RULES:
- Follow the user's instructions precisely
- Preserve the overall structure and formatting of the section unless told to change it
- Preserve any images, styles, and special elements exactly as-is
- Maintain professional government contracting language
- Keep inline styles consistent with the existing content
- If the user asks to add content, integrate it naturally into the existing section
- If the user asks to rewrite, produce a complete replacement for the section
- If the user asks to improve, enhance the existing content while keeping the structure
- Support every claim with evidence when possible
- Use specific metrics and data points when available from tools

TOOL USAGE:
You have access to tools to gather specific data for this section:
- search_past_performance: Find relevant past projects by keywords
- search_knowledge_base: Search company capabilities, processes, certifications
- get_qa_answers: Filter Q&A pairs by topic
- get_organization_context: Get org details, contacts, team members
- get_executive_brief_analysis: Get pre-analyzed opportunity intelligence
- get_pricing_data: Get labor rates, cost estimates, staffing plans
- get_content_library: Search pre-approved content snippets
- get_deadlines: Get deadline information

Use these tools proactively when the user's instruction requires specific data.`;

const buildSectionEditUserPrompt = (args: {
  instruction: string;
  currentSectionHtml: string;
  sectionTitle: string;
  solicitation: string;
  enrichedContext: string;
}): string => {
  const { instruction, currentSectionHtml, sectionTitle, solicitation, enrichedContext } = args;

  const parts: string[] = [];

  parts.push(`═══════════════════════════════════════
USER INSTRUCTION
═══════════════════════════════════════
${instruction}`);

  parts.push(`═══════════════════════════════════════
CURRENT SECTION HTML (Section: "${sectionTitle}")
═══════════════════════════════════════
${currentSectionHtml}`);

  if (solicitation) {
    const truncatedSolicitation = solicitation.length > MAX_CONTEXT_CHARS
      ? solicitation.substring(0, MAX_CONTEXT_CHARS) + '\n\n[... solicitation truncated for section edit ...]'
      : solicitation;
    parts.push(`═══════════════════════════════════════
SOLICITATION CONTEXT (for reference)
═══════════════════════════════════════
${truncatedSolicitation}`);
  }

  if (enrichedContext) {
    const truncatedContext = enrichedContext.length > MAX_CONTEXT_CHARS
      ? enrichedContext.substring(0, MAX_CONTEXT_CHARS) + '\n\n[... context truncated for section edit ...]'
      : enrichedContext;
    parts.push(`═══════════════════════════════════════
ENRICHMENT CONTEXT (Knowledge Base, Past Performance, etc.)
═══════════════════════════════════════
${truncatedContext}`);
  }

  parts.push(`═══════════════════════════════════════
YOUR TASK
═══════════════════════════════════════
Edit the section "${sectionTitle}" according to the user's instruction above.
Return ONLY the updated HTML for this section. Start with the section heading.
Do NOT return JSON or any text outside the HTML.`);

  return parts.join('\n\n');
};

// ─── Handler ───

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    // 1. Parse & validate input
    const { success, data, error } = EditSectionInputSchema.safeParse(
      JSON.parse(event?.body || '{}'),
    );
    if (!success) {
      return apiResponse(400, { message: 'Validation error', errors: error.format() });
    }

    const { projectId, opportunityId, documentId, sectionTitle, currentSectionHtml, instruction } = data;

    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'orgId is required' });

    const userId = getUserId(event);

    // 2. Verify document exists
    const doc = await getRFPDocument(projectId, opportunityId, documentId);
    if (!doc) return apiResponse(404, { message: 'Document not found' });

    // Set audit context early
    setAuditContext(event, {
      action: 'DOCUMENT_SECTION_EDIT_STARTED',
      resource: 'document',
      resourceId: documentId,
    });

    // 3. Load context with a strict 8s timeout — API Gateway has a 29s hard limit,
    //    so we budget ~8s for context, ~18s for Bedrock, ~3s for overhead.
    //    If gatherAllContext is slow, we proceed with whatever we have — tools can fill gaps.
    const CONTEXT_TIMEOUT_MS = 8_000;
    const withTimeout = <T,>(p: Promise<T>, fallback: T): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), CONTEXT_TIMEOUT_MS);
        timer.unref?.();
      });
      return Promise.race([p, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    };

    // Load solicitation first so gatherAllContext can use it for KB/past-perf searches
    const solicitationPromise = withTimeout(
      loadSolicitation(projectId, opportunityId).catch(() => ''), '',
    );

    const [qaPairs, solicitation, enrichedContext] = await Promise.all([
      withTimeout(loadQaPairs(projectId, opportunityId).catch(() => [] as QaPair[]), [] as QaPair[]),
      solicitationPromise,
      withTimeout(
        solicitationPromise.then((loadedSolicitation) =>
          gatherAllContext({
            projectId, orgId, opportunityId, solicitation: loadedSolicitation,
            documentType: doc.documentType ?? 'TECHNICAL_PROPOSAL',
          }),
        ).catch(() => ''),
        '',
      ),
    ]);

    console.log(`[edit-section] Context loaded: solicitation=${solicitation.length} chars, enriched=${enrichedContext.length} chars, qaPairs=${qaPairs.length}`);

    // 4. Build prompts
    const systemPrompt = buildSectionEditSystemPrompt(sectionTitle);
    const userPrompt = buildSectionEditUserPrompt({
      instruction,
      currentSectionHtml,
      sectionTitle,
      solicitation,
      enrichedContext,
    });

    console.log(`[edit-section] Starting section edit for "${sectionTitle}" in document ${documentId}`);
    console.log(`[edit-section] Prompt sizes: system=${systemPrompt.length}, user=${userPrompt.length}`);

    // 5. Call Bedrock with tool-use loop
    const messages: Array<{ role: string; content: unknown }> = [
      { role: 'user', content: [{ type: 'text', text: userPrompt }] },
    ];

    let resultHtml = '';
    let toolRounds = 0;

    while (toolRounds <= MAX_TOOL_ROUNDS) {
      const isLastRound = toolRounds >= MAX_TOOL_ROUNDS;

      // Always include tools when tool_use/tool_result messages exist in the
      // conversation — the API expects definitions for any tool blocks present.
      // On the last round we still provide tools but omit tool_choice so the
      // model can choose to respond with text only.
      const hasToolMessages = messages.some(
        m => Array.isArray(m.content) && (m.content as Array<{ type: string }>).some(
          c => c.type === 'tool_use' || c.type === 'tool_result',
        ),
      );

      const requestBody: Record<string, unknown> = {
        anthropic_version: 'bedrock-2023-05-31',
        system: [{ type: 'text', text: systemPrompt }],
        messages,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      };

      if (!isLastRound || hasToolMessages) {
        requestBody.tools = DOCUMENT_TOOLS;
      }

      const responseBody = await invokeModelWithRetry(BEDROCK_MODEL_ID, JSON.stringify(requestBody));
      const parsed = JSON.parse(new TextDecoder('utf-8').decode(responseBody));

      const stopReason: string = parsed.stop_reason ?? 'end_turn';
      const content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }> =
        parsed.content ?? [];

      const contentTypes = content.map(c => c.type).join(', ');
      console.log(`[edit-section] Bedrock response: stop_reason=${stopReason}, content_types=[${contentTypes}], round=${toolRounds}/${MAX_TOOL_ROUNDS}`);

      if (stopReason === 'tool_use' && !isLastRound) {
        const toolUseBlocks = content.filter(c => c.type === 'tool_use');
        console.log(`[edit-section] Tool use round ${toolRounds + 1}: ${toolUseBlocks.length} tool call(s)`);

        messages.push({ role: 'assistant', content });

        const toolResults = await Promise.all(
          toolUseBlocks.map(block =>
            executeDocumentTool({
              toolName: block.name ?? '',
              toolInput: (block.input ?? {}) as Record<string, unknown>,
              toolUseId: block.id ?? '',
              orgId,
              projectId,
              opportunityId,
              documentId,
              qaPairs,
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

        toolRounds++;
        continue;
      }

      // Extract text response
      resultHtml = content
        .filter(c => c.type === 'text')
        .map(c => c.text ?? '')
        .join('\n')
        .trim();

      // Handle last round producing no text (tool_use without text, or empty response)
      if (!resultHtml && isLastRound) {
        console.warn(`[edit-section] Last round produced no text (stop_reason=${stopReason}) — forcing final generation`);
        messages.push({ role: 'assistant', content });

        // Every tool_use block must have a matching tool_result — provide stubs
        // so the conversation is valid before appending the text prompt.
        const toolUseIds = content
          .filter(c => c.type === 'tool_use' && c.id)
          .map(c => c.id as string);

        if (toolUseIds.length > 0) {
          messages.push({
            role: 'user',
            content: toolUseIds.map(id => ({
              type: 'tool_result',
              tool_use_id: id,
              content: 'Skipped — generating final output now.',
            })),
          });
        }

        messages.push({
          role: 'user',
          content: [{ type: 'text', text: 'Now generate the updated section HTML based on all the information gathered. Return ONLY the HTML.' }],
        });
        const finalBody: Record<string, unknown> = {
          anthropic_version: 'bedrock-2023-05-31',
          system: [{ type: 'text', text: systemPrompt }],
          messages,
          max_tokens: MAX_TOKENS,
          temperature: TEMPERATURE,
          tools: DOCUMENT_TOOLS,
        };
        const finalResponse = await invokeModelWithRetry(BEDROCK_MODEL_ID, JSON.stringify(finalBody));
        const finalParsed = JSON.parse(new TextDecoder('utf-8').decode(finalResponse));
        const finalContent: Array<{ type: string; text?: string }> = finalParsed.content ?? [];
        resultHtml = finalContent.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n').trim();
      }

      console.log(`[edit-section] Generation complete after ${toolRounds} tool round(s), ${resultHtml.length} chars`);
      break;
    }

    // 6. Clean up the result
    // Strip markdown code fences if the model wrapped the HTML
    resultHtml = resultHtml
      .replace(/^```html?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();

    if (!resultHtml) {
      setAuditContext(event, {
        action: 'DOCUMENT_SECTION_EDIT_FAILED',
        resource: 'document',
        resourceId: documentId,
      });

      // Persist failed chat messages (non-blocking)
      saveChatMessages({
        orgId, projectId, opportunityId, documentId, sectionTitle,
        userInstruction: instruction,
        assistantContent: 'Failed to edit section: AI produced no content.',
        applied: false,
        error: 'AI produced no content for the section edit',
        toolRoundsUsed: toolRounds,
        userId,
      }).catch(err => console.warn('Failed to persist chat messages (non-blocking):', (err as Error).message));

      return apiResponse(500, { message: 'AI produced no content for the section edit' });
    }

    // 7. Persist chat messages (non-blocking — don't delay the response)
    saveChatMessages({
      orgId, projectId, opportunityId, documentId, sectionTitle,
      userInstruction: instruction,
      assistantContent: `Updated section "${sectionTitle}" successfully.${
        toolRounds > 0 ? ` Used ${toolRounds} tool round${toolRounds > 1 ? 's' : ''} to gather context.` : ''
      }`,
      updatedHtml: resultHtml,
      applied: true,
      toolRoundsUsed: toolRounds,
      userId,
    }).catch(err => console.warn('Failed to persist chat messages (non-blocking):', (err as Error).message));

    // 8. Return the updated section HTML
    setAuditContext(event, {
      action: 'DOCUMENT_SECTION_EDIT_COMPLETED',
      resource: 'document',
      resourceId: documentId,
    });

    return apiResponse(200, {
      ok: true,
      sectionTitle,
      updatedHtml: resultHtml,
      toolRoundsUsed: toolRounds,
    });
  } catch (err) {
    console.error('Error in edit-section handler:', err);
    return apiResponse(500, {
      message: err instanceof Error ? err.message : 'Internal server error during section edit',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);

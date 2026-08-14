/**
 * POST /package-edit/chat
 *
 * The UNIFIED chat turn for editors (proposal:edit). A SINGLE agentic loop
 * (Haiku, bounded rounds, <29s) reads the package with the compliance read tools
 * and either:
 *   - answers with review findings (REVIEW), or
 *   - calls propose_edits → we start an async proposal run (EDIT).
 *
 * IMPORTANT: this is ONE model loop. An earlier version routed intent in a first
 * loop and then ran a SECOND full review loop for REVIEW turns — the two passes
 * summed to ~32s and blew API Gateway's 29s limit (503, nothing persisted). The
 * combined-loop design keeps a review turn to a single pass.
 *
 * Both outcomes persist to the shared compliance-review chat history so the
 * unified chat is one durable, refresh-safe stream. An EDIT turn's assistant
 * message carries `editRunId` so the UI renders the run inline.
 *
 * Permission: proposal:edit (ADMIN + EDITOR). Read-only users use the compliance
 * chat endpoint instead (the frontend routes by permission).
 */
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, parseJsonBody } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import { getOpportunity } from '@/helpers/opportunity';
import { invokeClaudeWithTools } from '@/helpers/bedrock-tool-loop';
import {
  COMPLIANCE_REVIEW_TOOLS,
  makeComplianceToolExecutor,
  buildPackageInventory,
} from '@/helpers/compliance-review-tools';
import { ReviewOutputSchema } from '@/helpers/compliance-review-engine';
import { validateAndTagFindings, type RawFinding } from '@/helpers/compliance-review-validate';
import { saveComplianceMessagePair, listComplianceReviewHistory } from '@/helpers/compliance-review';
import { MAX_TOKENS } from '@/constants/compliance-review';
import { createProposalRun } from '@/helpers/package-edit';
import { enqueuePackageEditProposal } from '@/helpers/package-edit-queue';
import { buildPackageSnapshot } from '@/helpers/compliance-review-snapshot';
import { MAX_TOOL_ROUNDS_CHAT } from '@/constants/package-edit';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { PackageEditChatRequestSchema, PackageEditChatResponseSchema } from '@auto-rfp/core';

const CHAT_MODEL_ID = requireEnv(
  'PACKAGE_EDIT_CHAT_MODEL_ID',
  'us.anthropic.claude-haiku-4-5-20251001-v1:0',
);

const QueryParamsSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  projectId: z.string().min(1, 'projectId is required'),
  opportunityId: z.string().min(1, 'opportunityId is required'),
});

// Recent turns fed back to the model so follow-ups ("yes", "use the full number")
// resolve in context. Bounded so the prompt stays small (well under any limit).
const HISTORY_TURNS = 8;
const HISTORY_MSG_MAX_CHARS = 500;

const PROPOSE_TOOL = {
  name: 'propose_edits',
  description:
    'Call this when the user wants to CHANGE, FIX, UPDATE, or PROPAGATE a value across the package ' +
    '(e.g. "make the total $2.4M everywhere", "the phone number is now X — update it everywhere"). ' +
    'Do NOT scan or read the package to enumerate occurrences yourself — calling this schedules an ' +
    'asynchronous scan. Pass a single, self-contained instruction describing exactly what to change.',
  input_schema: {
    type: 'object',
    properties: {
      instruction: {
        type: 'string',
        description:
          'A self-contained edit instruction, e.g. "Set the estimated total cost to $2.4M everywhere it appears."',
      },
    },
    required: ['instruction'],
  },
} as const;

// One combined system prompt: review by default, propose_edits for mutations.
// Extends the compliance review contract (answer + findings JSON) with the edit tool.
const SYSTEM_PROMPT = `You are the assistant for a US federal proposal package. You can BOTH review the package (answer questions, surface compliance issues) AND make edits across it.

DECIDE:
- If the user clearly wants to CHANGE / FIX / UPDATE / PROPAGATE / FILL a value across the package AND you have what you need to do it, call the propose_edits tool with a single self-contained instruction. Do NOT enumerate occurrences yourself — an async scan handles that. When you call propose_edits you are done.
- If an edit request is ambiguous or the new value looks invalid/incomplete (e.g. a phone number with too few digits), do NOT call propose_edits — instead ASK a clarifying question in the "answer" field (see REVIEW OUTPUT) with an empty findings array.
- Otherwise treat it as a REVIEW question. Use the read tools (list_package_documents, get_document_section, get_form_fields, get_questionnaire_cells, search_solicitation) to inspect the real content, then output the review JSON.

CRITICAL — starting an edit is done ONLY by CALLING the propose_edits tool. NEVER claim in the "answer" that an edit has been submitted, queued, scheduled, is "processing", is "running in the background", or is being scanned — the ONLY way any of that happens is the propose_edits tool call, and after you call it the system shows the progress itself (you do not narrate it). If the user wants a change, either call propose_edits or ask a clarifying question. Do NOT describe asynchronous work in prose.

REVIEW / ANSWER OUTPUT — return ONLY a JSON object, no fences. Put ANY plain reply (an answer, or a clarifying question) in "answer":
{
  "answer": "<a human-readable answer, or a clarifying question if you need more info before editing>",
  "findings": [
    {
      "findingId": "<any short id>",
      "targetKind": "RFP_DOCUMENT | XLSX_QUESTIONNAIRE | XLSX_FORM | PDF_FORM | FORM_MISSING",
      "documentId": "<id from list_package_documents>",
      "documentTitle": "<title>",
      "anchor": { "kind": "heading", "text": "<EXACT heading>" },
      "snippet": "<SHORT verbatim excerpt copied from tool output>",
      "issueType": "MISSING_REQUIREMENT | MISSING_FORM | INCORRECT_ANSWER | POOR_ANSWER | FORMAT_ISSUE | INCONSISTENCY | OTHER",
      "severity": "critical | major | minor | info",
      "title": "<one-line summary>",
      "description": "<what is wrong / the finding>",
      "suggestion": "<how to fix>"
    }
  ]
}
An empty findings array with a brief answer is valid (use this for a direct answer or a clarifying question). Base every finding on text you actually retrieved. Your FINAL message MUST be either a propose_edits call or this JSON — never bare prose (wrap any prose reply in the "answer" field).`;

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { success: qOk, data: query, error: qErr } = QueryParamsSchema.safeParse(event.queryStringParameters);
  if (!qOk) {
    return apiResponse(400, { message: 'Invalid query parameters', issues: qErr.issues });
  }
  const { orgId, projectId, opportunityId: oppId } = query;

  const parsedBody = parseJsonBody(event);
  if (parsedBody === undefined) return apiResponse(400, { message: 'Invalid JSON body' });
  const { success, data, error } = PackageEditChatRequestSchema.safeParse(parsedBody);
  if (!success) {
    return apiResponse(400, { message: 'Invalid request body', issues: error.issues });
  }

  const opportunity = await getOpportunity({ orgId, projectId, oppId });
  if (!opportunity) return apiResponse(404, { message: 'Opportunity not found' });

  const userId = event.auth?.userId ?? 'system';
  const userName =
    (event.auth?.claims?.name as string | undefined) ??
    (event.auth?.claims?.email as string | undefined) ??
    'system';

  // Recent conversation as context so follow-ups resolve (multi-turn). Best-effort:
  // a history-load failure must not break the turn.
  let historyBlock = '';
  try {
    const history = await listComplianceReviewHistory(orgId, projectId, oppId);
    const recent = history.slice(-HISTORY_TURNS);
    if (recent.length > 0) {
      historyBlock =
        'CONVERSATION SO FAR (context only — act on the CURRENT message, do not re-run past edits):\n' +
        recent
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, HISTORY_MSG_MAX_CHARS)}`)
          .join('\n') +
        '\n\n';
    }
  } catch (err) {
    console.warn('[package-edit-chat] history load failed (continuing stateless):', (err as Error)?.message);
  }

  // ONE loop: compliance read tools + propose_edits. The propose_edits executor
  // only records the instruction (no scan on the request path); the read tools
  // let the model answer review questions in the SAME pass.
  const inventory = await buildPackageInventory({ orgId, projectId, oppId });
  const readExecutor = makeComplianceToolExecutor({ orgId, oppId, inventory });

  let capturedInstruction: string | undefined;
  const executor = async (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolUseId: string,
  ) => {
    if (toolName === 'propose_edits') {
      capturedInstruction = String(toolInput.instruction ?? data.message);
      return {
        tool_use_id: toolUseId,
        content: 'Acknowledged — an async proposal run will be scheduled. Output the review JSON now (empty findings is fine).',
      };
    }
    return readExecutor(toolName, toolInput, toolUseId);
  };

  // `capturedInstruction` is set as a side-effect the moment propose_edits fires
  // during the loop — BEFORE the final-message JSON parse. So if the model calls
  // the tool and then replies with prose the parser can't rescue,
  // invokeClaudeWithTools throws, but we already know this is an EDIT turn. Only
  // rethrow when NO tool fired (a genuine review-output failure); otherwise fall
  // through to the EDIT branch, which doesn't use `output` at all.
  let output: z.infer<typeof ReviewOutputSchema> | null = null;
  try {
    output = await invokeClaudeWithTools<z.infer<typeof ReviewOutputSchema>>({
      modelId: CHAT_MODEL_ID,
      system: SYSTEM_PROMPT,
      user: `${historyBlock}The user's CURRENT message: "${data.message}"`,
      tools: [...COMPLIANCE_REVIEW_TOOLS, PROPOSE_TOOL],
      toolExecutor: executor,
      outputSchema: ReviewOutputSchema,
      maxTokens: MAX_TOKENS,
      maxToolRounds: MAX_TOOL_ROUNDS_CHAT,
    });
  } catch (err) {
    if (!capturedInstruction) throw err; // real review failure — surface it
    console.warn(
      '[package-edit-chat] final-output parse failed but propose_edits fired; proceeding with the edit:',
      (err as Error)?.message,
    );
  }

  // ── EDIT: propose_edits was called → start the async run, persist, return ──
  if (capturedInstruction) {
    const snapshotVersionIds = await buildPackageSnapshot({ orgId, projectId, oppId });
    const run = await createProposalRun({ orgId, projectId, oppId, instruction: capturedInstruction, snapshotVersionIds });
    if (!run) {
      return apiResponse(409, {
        message: 'A proposal run is already in progress for this opportunity. Please wait for it to finish.',
      });
    }
    await enqueuePackageEditProposal({ orgId, projectId, oppId, runId: run.runId });

    const answer = 'Analyzing the package for that change — this runs in the background.';
    const { assistantMsg } = await saveComplianceMessagePair({
      orgId, projectId, oppId,
      userMessage: data.message,
      assistantAnswer: answer,
      findings: [],
      userId: event.auth?.userId,
      editRunId: run.runId,
    });

    writeAuditLog(
      {
        logId: uuidv4(),
        timestamp: nowIso(),
        userId,
        userName,
        organizationId: orgId,
        action: 'PACKAGE_EDIT_PROPOSAL_STARTED',
        resource: 'package_edit_run',
        resourceId: run.runId,
        changes: { after: { oppId, instruction: capturedInstruction } },
        ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
        userAgent: event.headers?.['user-agent'] ?? 'system',
        result: 'success',
      },
      await getHmacSecret(),
    ).catch((err) => console.warn('Failed to write audit log (non-blocking):', err));

    return apiResponse(
      200,
      PackageEditChatResponseSchema.parse({
        messageId: assistantMsg.messageId,
        answer,
        intent: 'EDIT',
        runId: run.runId,
        findings: [],
      }),
    );
  }

  // ── REVIEW: validate the single-loop output's findings, persist, return ────
  // Reaching here means no tool fired, so a parse failure would already have been
  // rethrown above — `output` is non-null. The `?? { … }` is a belt-and-braces
  // default so a future reordering can never dereference null.
  const reviewOutput = output ?? { answer: '', findings: [] };
  const findings = await validateAndTagFindings(reviewOutput.findings as RawFinding[], inventory);
  const answer =
    reviewOutput.answer.trim() ||
    (findings.length > 0
      ? `I found ${findings.length} potential issue${findings.length === 1 ? '' : 's'} — see below.`
      : "I'm not sure how to help with that. To make a change, tell me the exact value to set (e.g. “change the contact phone to (937) 555-0199 everywhere”); to review, ask about a document or requirement.");

  const { assistantMsg } = await saveComplianceMessagePair({
    orgId, projectId, oppId,
    userMessage: data.message,
    assistantAnswer: answer,
    findings,
    userId: event.auth?.userId,
  });

  return apiResponse(
    200,
    PackageEditChatResponseSchema.parse({ messageId: assistantMsg.messageId, answer, intent: 'REVIEW', findings }),
  );
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:edit')),
);

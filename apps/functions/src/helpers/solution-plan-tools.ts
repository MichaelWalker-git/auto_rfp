/**
 * solution-plan-tools.ts
 *
 * Tool set offered to the Tech Lead agent during the Solution Plan grilling
 * loop (T6): the org-grounding subset of DOCUMENT_TOOLS plus
 * `search_service_pricing` for third-party price lookups.
 *
 * The executor delegates shared tools to `executeDocumentTool` so behavior
 * (and tool-usage audit logging) stays identical to document generation.
 */

import { z } from 'zod';

import { DOCUMENT_TOOLS, executeDocumentTool } from './document-tools';
import type { ToolDefinition, ToolResult } from '@/types/tool';

/** Max services per search_service_pricing call (batched — see tool description). */
const MAX_PRICING_BATCH = 10;

// ─── Tool set ───────────────────────────────────────────────────────────────────

/** DOCUMENT_TOOLS offered to the Tech Lead (ROADMAP §2). */
export const SOLUTION_PLAN_SHARED_TOOL_NAMES = [
  'search_knowledge_base',
  'search_past_performance',
  'get_organization_context',
  'get_pricing_data',
  'get_executive_brief_analysis',
] as const;

const isSharedToolName = (name: string): boolean =>
  (SOLUTION_PLAN_SHARED_TOOL_NAMES as readonly string[]).includes(name);

/**
 * Batched third-party pricing lookup (T3's schema). Batched because doc/plan
 * generation allows few tool rounds — the model must request ALL services in
 * ONE call.
 */
const SEARCH_SERVICE_PRICING_TOOL: ToolDefinition = {
  name: 'search_service_pricing',
  description:
    'Look up current public list prices for third-party services, subscriptions, and licenses ' +
    '(e.g. cloud services, SaaS tools, software licenses). ' +
    'IMPORTANT: request ALL third-party services you need in ONE call — batch them into the services array. ' +
    'Returns a table with price, unit, billing period, and source per service. ' +
    'All results are estimates subject to vendor quote; never invent a price yourself.',
  input_schema: {
    type: 'object',
    properties: {
      services: {
        type: 'array',
        maxItems: MAX_PRICING_BATCH,
        items: {
          type: 'object',
          properties: {
            serviceName: {
              type: 'string',
              description: 'Exact service/product name including tier if known. Example: "GitHub Enterprise Cloud" or "Datadog Pro"',
            },
            billingPeriod: {
              type: 'string',
              enum: ['MONTHLY', 'ANNUAL', 'ONE_TIME', 'USAGE_BASED', 'UNKNOWN'],
              description: 'Expected billing period. Omit if unknown.',
            },
          },
          required: ['serviceName'],
        },
        description: `ALL third-party services to price, in one batch (max ${MAX_PRICING_BATCH}).`,
      },
    },
    required: ['services'],
  },
};

export const SOLUTION_PLAN_TOOLS: ReadonlyArray<ToolDefinition> = [
  ...DOCUMENT_TOOLS.filter((t) => isSharedToolName(t.name)),
  SEARCH_SERVICE_PRICING_TOOL,
];

// ─── search_service_pricing executor ────────────────────────────────────────────

/**
 * TODO(T3): replace with the real Brave-backed `searchServicePricing` from
 * `@/helpers/service-pricing` once T3 lands. Until then every row degrades to
 * "vendor quote required (lookup unavailable)" — the shape ADR-15 mandates for
 * total outage, so the Tech Lead prompt rules already handle it correctly.
 */
const ServicePricingInputSchema = z.object({
  services: z.array(z.object({ serviceName: z.string() }).passthrough()),
});

const executeSearchServicePricing = (toolInput: Record<string, unknown>): string => {
  const { success, data } = ServicePricingInputSchema.safeParse(toolInput);
  const serviceNames = (success ? data.services : [])
    .map((s) => s.serviceName.trim())
    .filter(Boolean)
    .slice(0, MAX_PRICING_BATCH);

  if (!serviceNames.length) {
    return 'No services provided. Pass all third-party services to price in the `services` array.';
  }

  const rows = serviceNames.map(
    (name) => `| ${name} | vendor quote required (lookup unavailable) | — | — | — |`,
  );

  return [
    '| Service | Price | Unit | Billing Period | Source |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    'ESTIMATES — subject to vendor quote. Live pricing lookup is unavailable; write "vendor quote required" for these services and do NOT invent prices.',
  ].join('\n');
};

// ─── Dispatcher ─────────────────────────────────────────────────────────────────

/**
 * Execute one Tech Lead tool call. Never throws into the tool loop (ADR-15) —
 * failures come back as text the model can work around.
 */
export const executeSolutionPlanTool = async (args: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  solutionPlanId: string;
}): Promise<ToolResult> => {
  const { toolName, toolInput, toolUseId, orgId, projectId, opportunityId, solutionPlanId } = args;

  if (toolName === 'search_service_pricing') {
    return { tool_use_id: toolUseId, content: executeSearchServicePricing(toolInput) };
  }

  if (!isSharedToolName(toolName)) {
    return { tool_use_id: toolUseId, content: `Unknown tool: ${toolName}` };
  }

  // Delegate to the document-tools dispatcher (it catches its own errors).
  // The plan id doubles as the audit-log resource id; grilling has no Q&A set.
  return executeDocumentTool({
    toolName,
    toolInput,
    toolUseId,
    orgId,
    projectId,
    opportunityId,
    documentId: solutionPlanId,
    qaPairs: [],
  });
};

/**
 * Claude Tool Use definitions and executors for RFP document generation.
 *
 * These tools allow Claude to actively query the database during document
 * generation rather than relying solely on pre-fetched context.
 *
 * Available tools (9 total):
 *  - search_past_performance      → semantic search over past projects
 *  - search_knowledge_base        → semantic search over company KB
 *  - get_qa_answers               → filter Q&A pairs by topic
 *  - get_organization_context     → org details, primary contact, project, team
 *  - get_executive_brief_analysis → pre-analyzed opportunity intelligence
 *  - get_pricing_data             → internal labor rates, estimates, staffing plans
 *  - get_content_library          → search pre-approved content snippets
 *  - get_deadlines                → deadline information for the opportunity
 *  - search_service_pricing       → web lookup of third-party service prices
 *                                   (COST_PROPOSAL / PRICE_VOLUME only — offer tools
 *                                   via getDocumentToolsForType, not DOCUMENT_TOOLS)
 */

import { searchPastProjects, getPastProject } from './past-performance';
import { isUsableInMatching, redactForGeneration, anonymizationNotice } from './past-performance-disclosure';
import { queryCompanyKnowledgeBase } from './executive-opportunity-brief';
import { loadTextFromS3 } from './s3';
import { requireEnv } from './env';
import { truncateText } from './executive-opportunity-brief';
import type { QaPair } from './document-generation';
import {
  fetchOrganizationDetails,
  fetchOrgPrimaryContact,
  fetchProjectDetails,
  fetchTeamMembers,
  fetchExecutiveBriefAnalysis,
  fetchContentLibraryMatches,
  fetchDeadlineInfo,
  logToolUsage,
} from './db-tool-helpers';
import type { BriefSectionName } from './executive-opportunity-brief';
import type { ToolResult } from '@/types/tool';
import { z } from 'zod';
import {
  ServicePricingLookupSchema,
  RFP_DOCUMENT_TYPES,
  type RFPDocumentType,
  type ServicePricingResult,
} from '@auto-rfp/core';
import { searchServicePricing } from './service-pricing';

export type { ToolResult };

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

// ─── Tool schemas (Claude tool_use format) ────────────────────────────────────

export const DOCUMENT_TOOLS = [
  {
    name: 'search_past_performance',
    description:
      'Search for relevant past performance projects by keywords. ' +
      'Use this when generating Past Performance, Technical Proposal, or any document ' +
      'that requires citing relevant past contracts. Returns project details including ' +
      'title, client, description, technologies, achievements, and performance ratings.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keywords: {
          type: 'string',
          description:
            'Search keywords describing the type of work, technology, domain, or client. ' +
            'Example: "cloud migration AWS federal agency" or "cybersecurity FISMA compliance"',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (1–5). Default: 3.',
        },
      },
      required: ['keywords'],
    },
  },
  {
    name: 'search_knowledge_base',
    description:
      'Search the company knowledge base for relevant capabilities, processes, certifications, ' +
      'or personnel information. Use this when you need specific company details to support ' +
      'a section (e.g., certifications for a Technical Proposal, management processes for ' +
      'Management Approach, or team qualifications).',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Search query describing what company information you need. ' +
            'Example: "ISO certifications quality management" or "key personnel program manager"',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of KB chunks to return (1–5). Default: 3.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_qa_answers',
    description:
      'Retrieve Q&A pairs relevant to a specific topic from the project\'s question-answer database. ' +
      'Use this to find pre-answered questions about the solicitation that are relevant to the ' +
      'section you are writing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topic: {
          type: 'string',
          description:
            'Topic or keyword to filter Q&A pairs. ' +
            'Example: "security clearance" or "period of performance" or "pricing"',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of Q&A pairs to return (1–10). Default: 5.',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'get_organization_context',
    description:
      'Retrieve organization, primary contact (proposal signatory), project, and team member ' +
      'information in a single call. Use this when generating Cover Letters, Commitment Statements, ' +
      'Team Qualifications, or any section requiring real company/personnel details. ' +
      'Includes: company name, address, CAGE/DUNS, primary contact name/title/email/phone, ' +
      'team member names and roles, and project name.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_executive_brief_analysis',
    description:
      'Retrieve pre-analyzed executive brief data for this opportunity. ' +
      'Returns structured analysis including: opportunity summary, key requirements, ' +
      'identified risks, contacts, deadlines, and bid/no-bid scoring. ' +
      'Use this when you need pre-analyzed intelligence about the opportunity ' +
      'to inform your document content, especially for Executive Summary, ' +
      'Understanding of Requirements, and Risk Management sections.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sections: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['summary', 'requirements', 'risks', 'contacts', 'deadlines', 'pricing', 'scoring'],
          },
          description: 'Which brief sections to retrieve. Omit to get all completed sections.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_pricing_data',
    description:
      'Retrieve pricing data from the pricing module for this opportunity. ' +
      'Returns labor rates, cost estimates, staffing plans, and bid analysis. ' +
      'Use this when generating Cost Proposal, Price Volume, or any document ' +
      'that needs actual pricing figures, labor rate tables, or cost breakdowns. ' +
      'Also useful for Executive Summary sections that reference pricing strategy.',
    input_schema: {
      type: 'object' as const,
      properties: {
        includeLabor: {
          type: 'boolean',
          description: 'Include labor rate table. Default: true.',
        },
        includeEstimates: {
          type: 'boolean',
          description: 'Include cost estimates. Default: true.',
        },
        includeStaffingPlans: {
          type: 'boolean',
          description: 'Include staffing plans. Default: true.',
        },
        includeBidAnalysis: {
          type: 'boolean',
          description: 'Include bid/no-bid pricing analysis. Default: true.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_content_library',
    description:
      'Search the organization\'s content library for pre-approved content snippets. ' +
      'The content library contains vetted Q&A pairs and boilerplate text approved for proposals. ' +
      'Use this when you need standard language for certifications, compliance statements, ' +
      'company descriptions, or recurring proposal themes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query. Example: "ISO 9001 certification" or "small business status"',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of content items to return (1–5). Default: 3.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_deadlines',
    description:
      'Retrieve deadline information for this opportunity. ' +
      'Returns submission deadlines, Q&A periods, site visit dates, and other key dates. ' +
      'Use this when generating Cover Letters, Project Plans, or any section referencing specific dates.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_service_pricing',
    description:
      'Look up current public prices for third-party services, subscriptions, and software licenses ' +
      'via live web search (e.g., cloud services, SaaS tools, developer platforms). ' +
      'Use this for the "Third-Party Services & Subscriptions" pricing in Cost Proposals and Price ' +
      'Volumes — NEVER invent or estimate third-party prices yourself. ' +
      'IMPORTANT: request ALL third-party services you need in ONE call (batched, max 10 services) — ' +
      'you may not get another tool round. ' +
      'Returns a table with one row per requested service: estimated price, plan/tier, source URL, ' +
      'and retrieval date. Rows where no price could be found say "vendor quote required". ' +
      'All returned prices are ESTIMATES subject to vendor quote. ' +
      'Do NOT use this for internal labor rates or cost estimates — use get_pricing_data for those.',
    input_schema: {
      type: 'object' as const,
      properties: {
        services: {
          type: 'array',
          maxItems: 10,
          description:
            'ALL third-party services to price, in one batched call (max 10).',
          items: {
            type: 'object',
            properties: {
              serviceName: {
                type: 'string',
                description:
                  'Vendor + product/plan name, specific enough to search. ' +
                  'Example: "Datadog Pro" or "GitHub Enterprise Cloud"',
              },
              billingPeriod: {
                type: 'string',
                enum: ['MONTHLY', 'ANNUAL', 'ONE_TIME', 'USAGE_BASED', 'UNKNOWN'],
                description: 'Billing period to price, if known.',
              },
            },
            required: ['serviceName'],
          },
        },
      },
      required: ['services'],
    },
  },
] as const;

export type ToolName = typeof DOCUMENT_TOOLS[number]['name'];

/** Document types allowed to call the third-party pricing web lookup (T3). */
export const PRICING_TOOL_DOC_TYPES: ReadonlySet<RFPDocumentType> = new Set(
  // `satisfies` pins these to real built-in types — a typo here would silently
  // withhold the pricing tool with no error anywhere.
  ['COST_PROPOSAL', 'PRICE_VOLUME'] satisfies (keyof typeof RFP_DOCUMENT_TYPES)[],
);

/**
 * Tools to offer the model for a given document type: `search_service_pricing`
 * is only offered for pricing documents (COST_PROPOSAL / PRICE_VOLUME), and
 * even then only when NO approved Solution Plan exists — a plan's "Selected
 * Services & Licenses" table is the single allowed third-party price source,
 * so live lookups are withheld (pricing single source, Fix A). All other types
 * get the base tool set. Generation code should pass the result of this — not
 * DOCUMENT_TOOLS directly — as the request's `tools`.
 */
export const getDocumentToolsForType = (
  documentType: RFPDocumentType,
  opts?: { hasSolutionPlan?: boolean },
) =>
  DOCUMENT_TOOLS.filter((tool) => {
    if (tool.name !== 'search_service_pricing') return true;
    if (!PRICING_TOOL_DOC_TYPES.has(documentType)) return false;
    return !opts?.hasSolutionPlan;
  });

// ─── Tool executors ───────────────────────────────────────────────────────────

const executePastPerformanceSearch = async (
  orgId: string,
  keywords: string,
  limit = 3,
): Promise<string> => {
  const topK = Math.min(Math.max(limit, 1), 5);
  try {
    const results = await searchPastProjects(orgId, keywords, topK * 2);
    if (!results.length) return 'No past performance projects found matching those keywords.';

    const relevant = results.filter(r => r.score >= 0.35).slice(0, topK);
    if (!relevant.length) return 'No sufficiently relevant past performance projects found.';

    const details = await Promise.all(
      relevant.map(async (r) => {
        const loaded = await getPastProject(orgId, r.projectId).catch(() => null);
        if (!loaded) return null;
        // Disclosure gate: drop DO_NOT_USE, redact non-NAMEABLE before it reaches the prompt.
        if (!isUsableInMatching(loaded)) return null;
        const project = redactForGeneration(loaded);

        const lines: string[] = [
          `**${project.title}** (relevance: ${Math.round(r.score * 100)}%)`,
          `Client: ${project.client}`,
        ];
        const notice = anonymizationNotice(loaded);
        if (notice) lines.push(notice);
        if (project.domain) lines.push(`Domain: ${project.domain}`);
        if (project.contractNumber) lines.push(`Contract: ${project.contractNumber}`);
        if (project.value) lines.push(`Value: $${project.value.toLocaleString()}`);
        if (project.startDate || project.endDate) {
          lines.push(`Period: ${project.startDate || '?'} – ${project.endDate || 'Present'}`);
        }
        if (project.teamSize) lines.push(`Team Size: ${project.teamSize}`);
        if (project.performanceRating) lines.push(`Performance Rating: ${project.performanceRating}/5`);
        if (project.description) lines.push(`Description: ${truncateText(project.description, 300)}`);
        if (project.technicalApproach) lines.push(`Technical Approach: ${truncateText(project.technicalApproach, 200)}`);
        if (project.technologies?.length) lines.push(`Technologies: ${project.technologies.slice(0, 8).join(', ')}`);
        if (project.achievements?.length) {
          lines.push(`Key Achievements:`);
          project.achievements.slice(0, 4).forEach(a => lines.push(`  • ${a}`));
        }
        if (project.naicsCodes?.length) lines.push(`NAICS: ${project.naicsCodes.join(', ')}`);
        return lines.join('\n');
      }),
    );

    const validDetails = details.filter((d): d is string => d !== null);
    if (!validDetails.length) return 'Could not load project details.';

    return `Found ${validDetails.length} relevant past performance project(s):\n\n${validDetails.join('\n\n---\n\n')}`;
  } catch (err) {
    console.warn('search_past_performance tool error:', (err as Error)?.message);
    return `Error searching past performance: ${(err as Error)?.message}`;
  }
};

const executeKnowledgeBaseSearch = async (
  orgId: string,
  query: string,
  limit = 3,
): Promise<string> => {
  const topK = Math.min(Math.max(limit, 1), 5);
  try {
    const matches = await queryCompanyKnowledgeBase(orgId, query, topK * 2);
    if (!matches?.length) return 'No knowledge base content found for that query.';

    const relevant = matches.filter(m => (m.score ?? 0) >= 0.40).slice(0, topK);
    if (!relevant.length) return 'No sufficiently relevant knowledge base content found.';

    const chunks = await Promise.all(
      relevant.map(async (m, i) => {
        const text = m.source?.chunkKey
          ? await loadTextFromS3(DOCUMENTS_BUCKET, m.source.chunkKey).catch(() => '')
          : '';
        if (!text.trim()) return null;
        return `[KB ${i + 1}] (score: ${m.score?.toFixed(2)})\n${truncateText(text, 600)}`;
      }),
    );

    const validChunks = chunks.filter((c): c is string => c !== null);
    if (!validChunks.length) return 'Could not load knowledge base content.';

    return `Found ${validChunks.length} relevant knowledge base excerpt(s):\n\n${validChunks.join('\n\n---\n\n')}`;
  } catch (err) {
    console.warn('search_knowledge_base tool error:', (err as Error)?.message);
    return `Error searching knowledge base: ${(err as Error)?.message}`;
  }
};

const executeGetQaAnswers = (
  qaPairs: QaPair[],
  topic: string,
  limit = 5,
): string => {
  const topK = Math.min(Math.max(limit, 1), 10);
  const topicLower = topic.toLowerCase();
  const keywords = topicLower.split(/\s+/).filter(w => w.length > 3);

  const scored = qaPairs
    .filter(qa => qa.answer?.trim())
    .map(qa => {
      const text = `${qa.question} ${qa.answer}`.toLowerCase();
      const matchCount = keywords.filter(k => text.includes(k)).length;
      return { qa, matchCount };
    })
    .filter(({ matchCount }) => matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount)
    .slice(0, topK);

  if (!scored.length) return `No Q&A pairs found related to "${topic}".`;

  const formatted = scored.map(({ qa }, i) =>
    `Q${i + 1}: ${qa.question}\nA${i + 1}: ${truncateText(qa.answer, 400)}`
  ).join('\n\n');

  return `Found ${scored.length} relevant Q&A pair(s) for "${topic}":\n\n${formatted}`;
};

const executeGetOrganizationContext = async (
  orgId: string,
  projectId: string,
): Promise<string> => {
  try {
    const [orgDetails, primaryContact, projectDetails, teamMembers] = await Promise.all([
      fetchOrganizationDetails(orgId),
      fetchOrgPrimaryContact(orgId),
      fetchProjectDetails(projectId),
      fetchTeamMembers(orgId, 10),
    ]);

    // Order: org details → project details (includes project contact with higher priority) → org primary contact → team
    // Project contact info takes precedence over org primary contact for proposal signatory/POC
    const parts = [orgDetails, projectDetails, primaryContact, teamMembers].filter(Boolean);
    return parts.length
      ? parts.join('\n\n')
      : 'No organization context available. Use placeholder values like [Company Name], [Contact Name], [Title], [Email], [Phone].';
  } catch (err) {
    console.warn('get_organization_context tool error:', (err as Error)?.message);
    return 'Could not load organization context. Use placeholder values like [Company Name], [Contact Name], [Title], [Email], [Phone].';
  }
};

// ─── Pricing Data Fetcher ─────────────────────────────────────────────────────

const fetchPricingData = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  includeLabor: boolean,
  includeEstimates: boolean,
  includeStaffingPlans: boolean,
  includeBidAnalysis: boolean,
): Promise<string> => {
  try {
    const {
      getLaborRatesByOrg,
      getCostEstimatesByOpportunity,
      getStaffingPlansByOpportunity,
      analyzePricingForBid,
    } = await import('./pricing');

    const parts: string[] = [];

    // Derive the rate basis from the opportunity's delivery-location constraint.
    const { resolveRateBasisForOpportunity } = await import('./pricing');
    const rateBasis = await resolveRateBasisForOpportunity(orgId, projectId, opportunityId);

    // Labor Rates
    if (includeLabor) {
      const laborRates = await getLaborRatesByOrg(orgId);
      const activeRates = laborRates.filter(r => r.isActive);
      if (activeRates.length > 0) {
        // For OFFSHORE basis, present the rate the model MUST bill each position at as the
        // single "Rate to use", with a resolved fallback to onshore when no offshore rate
        // exists — so the model never has to re-derive which column applies.
        const rateLines = activeRates.map(r => {
          const hasOffshore = typeof r.offshoreFullyLoadedRate === 'number' && r.offshoreFullyLoadedRate > 0;
          if (rateBasis === 'OFFSHORE') {
            const rateToUse = hasOffshore ? r.offshoreFullyLoadedRate! : r.fullyLoadedRate;
            const source = hasOffshore ? 'OFFSHORE' : 'ONSHORE (no offshore rate on file — exception)';
            return `  ${r.position}: Rate to use $${rateToUse.toFixed(2)}/hr [${source}]` +
              ` (onshore $${r.fullyLoadedRate.toFixed(2)}` +
              (hasOffshore ? `, offshore $${r.offshoreFullyLoadedRate!.toFixed(2)}` : '') + '/hr)' +
              (r.rateJustification ? ` [${r.rateJustification}]` : '');
          }
          return `  ${r.position}: Rate to use $${r.fullyLoadedRate.toFixed(2)}/hr [ONSHORE]` +
            ` (Base $${r.baseRate.toFixed(2)}, OH ${r.overhead}%, G&A ${r.ga}%, Profit ${r.profit}%)` +
            (r.rateJustification ? ` [${r.rateJustification}]` : '');
        });
        parts.push(
          `=== RATE BASIS: ${rateBasis} (AUTHORITATIVE — from confirmed opportunity delivery constraint) ===\n` +
          (rateBasis === 'OFFSHORE'
            ? 'Offshore/remote-delivery eligibility for this opportunity has ALREADY been determined and confirmed. Do NOT re-evaluate it from the solicitation, and do NOT revert to onshore over data-residency/records/sensitivity concerns. For each position, bill labor at the "Rate to use" shown below — the OFFSHORE fully-loaded rate where one exists. Positions marked ONSHORE (exception) have no offshore rate on file; use their onshore rate. Do NOT substitute onshore rates for positions that have an offshore rate, and NEVER relabel onshore numbers as offshore.'
            : 'Price labor at the onshore "Rate to use" shown below.'),
        );
        parts.push(`=== LABOR RATE TABLE (${activeRates.length} active rates) ===\n${rateLines.join('\n')}`);
      }
    }

    // Cost Estimates
    if (includeEstimates) {
      const estimates = await getCostEstimatesByOpportunity(orgId, projectId, opportunityId);
      if (estimates.length > 0) {
        for (const est of estimates) {
          const estLines = [
            `Estimate: ${est.name}`,
            `Strategy: ${est.strategy}`,
            `Total Direct Cost: $${est.totalDirectCost.toLocaleString()}`,
            `Total Indirect Cost: $${est.totalIndirectCost.toLocaleString()}`,
            `Total Cost: $${est.totalCost.toLocaleString()}`,
            `Margin: ${est.margin}%`,
            `Total Price: $${est.totalPrice.toLocaleString()}`,
          ];
          if (est.competitivePosition) estLines.push(`Competitive Position: ${est.competitivePosition}`);

          if (est.laborCosts.length > 0) {
            estLines.push(`\nLabor Costs (${est.laborCosts.length} items):`);
            est.laborCosts.forEach(lc => estLines.push(`  ${lc.name}: ${lc.quantity} hrs × $${lc.unitCost.toFixed(2)} = $${lc.totalCost.toLocaleString()}`));
          }
          if (est.materialCosts.length > 0) {
            estLines.push(`\nMaterial Costs (${est.materialCosts.length} items):`);
            est.materialCosts.forEach(mc => estLines.push(`  ${mc.name}: ${mc.quantity} × $${mc.unitCost.toFixed(2)} = $${mc.totalCost.toLocaleString()}`));
          }

          parts.push(`=== COST ESTIMATE ===\n${estLines.join('\n')}`);

          // Bid Analysis
          if (includeBidAnalysis) {
            const analysis = analyzePricingForBid(est);
            const analysisLines = [
              `Competitive Position: ${analysis.competitivePosition}`,
              `Price Confidence: ${analysis.priceConfidence}%`,
              `Margin Adequacy: ${analysis.marginAdequacy}`,
              `Scoring Impact: ${analysis.scoringImpact.pricingPositionScore}/5 — ${analysis.scoringImpact.justification}`,
            ];
            if (analysis.competitiveAdvantages.length > 0) {
              analysisLines.push(`Competitive Advantages: ${analysis.competitiveAdvantages.join('; ')}`);
            }
            if (analysis.pricingRisks.length > 0) {
              analysisLines.push(`Pricing Risks: ${analysis.pricingRisks.join('; ')}`);
            }
            if (analysis.recommendedActions.length > 0) {
              analysisLines.push(`Recommended Actions: ${analysis.recommendedActions.join('; ')}`);
            }
            parts.push(`=== BID/NO-BID PRICING ANALYSIS ===\n${analysisLines.join('\n')}`);
          }
        }
      }
    }

    // Staffing Plans
    if (includeStaffingPlans) {
      const plans = await getStaffingPlansByOpportunity(orgId, projectId, opportunityId);
      if (plans.length > 0) {
        for (const plan of plans) {
          const planLines = [
            `Plan: ${plan.name}`,
            `Total Labor Cost: $${plan.totalLaborCost.toLocaleString()}`,
            `Positions:`,
          ];
          plan.laborItems.forEach(item => {
            planLines.push(`  ${item.position}: ${item.hours} hrs × $${item.rate.toFixed(2)}/hr = $${item.totalCost.toLocaleString()}${item.phase ? ` (${item.phase})` : ''}`);
          });
          parts.push(`=== STAFFING PLAN ===\n${planLines.join('\n')}`);
        }
      }
    }

    if (parts.length === 0) {
      return '';
    }

    return parts.join('\n\n');
  } catch (err) {
    console.warn('fetchPricingData error:', (err as Error)?.message);
    return '';
  }
};

// ─── Third-Party Service Pricing (web lookup) ────────────────────────────────

const SearchServicePricingInputSchema = z.object({
  // No max here: the helper caps at 10 and degrades extras to "vendor quote
  // required" rows, which reads better to the model than a validation error.
  services: z.array(ServicePricingLookupSchema).min(1),
});

const formatPricingRow = (r: ServicePricingResult, lookupUnavailable: boolean): string => {
  if (!r.found || r.price === undefined) {
    const note = lookupUnavailable ? 'vendor quote required (lookup unavailable)' : 'vendor quote required';
    return `| ${r.serviceName} | ${r.billingPeriod} | ${note} | — | — | — | — |`;
  }
  const price = `${r.price} ${r.currency ?? 'USD'}${r.unit ? ` ${r.unit}` : ''}`;
  const retrieved = r.retrievedAt ? r.retrievedAt.slice(0, 10) : 'unknown';
  return `| ${r.serviceName} | ${r.billingPeriod} | ${price} | ${r.tier ?? '—'} | ${r.confidence ?? '—'} | ${r.sourceUrl ?? '—'} | ${retrieved} |`;
};

const formatPricingTable = (results: ServicePricingResult[], lookupUnavailable: boolean): string => {
  const foundCount = results.filter(r => r.found).length;
  return [
    `THIRD-PARTY SERVICE PRICING — ${foundCount} of ${results.length} service(s) priced:`,
    '',
    '| Service | Billing Period | Price (estimate) | Tier | Confidence | Source URL | Retrieved |',
    '|---|---|---|---|---|---|---|',
    ...results.map(r => formatPricingRow(r, lookupUnavailable)),
    '',
    'ESTIMATES — subject to vendor quote. In the document, label each price as an estimate and ' +
    'write "vendor quote required" for services without a price. Do NOT print the Source URLs or ' +
    'Retrieved dates in the document — they are internal traceability only.',
  ].join('\n');
};

/**
 * Batched third-party price lookup. Never throws into the tool loop (ADR-15):
 * invalid input returns an instructive message, and a total lookup outage
 * (Brave down, quota exhausted, SSM key missing) degrades every row to
 * "vendor quote required (lookup unavailable)" so the document always completes.
 */
const executeSearchServicePricing = async (
  toolInput: Record<string, unknown>,
): Promise<string> => {
  const { success, data, error } = SearchServicePricingInputSchema.safeParse(toolInput);
  if (!success) {
    return (
      `Invalid search_service_pricing input: ${error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}. ` +
      'Expected { "services": [{ "serviceName": string, "billingPeriod"?: "MONTHLY" | "ANNUAL" | "ONE_TIME" | "USAGE_BASED" | "UNKNOWN" }] } ' +
      'with at least one service. Write "vendor quote required" for any service you cannot look up.'
    );
  }

  try {
    return formatPricingTable(await searchServicePricing({ services: data.services }), false);
  } catch (err) {
    console.warn('search_service_pricing lookup unavailable, degrading all rows:', (err as Error)?.message);
    const degraded: ServicePricingResult[] = data.services.map(s => ({
      serviceName: s.serviceName,
      billingPeriod: s.billingPeriod ?? 'UNKNOWN',
      found: false,
      fromCache: false,
    }));
    return formatPricingTable(degraded, true);
  }
};

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

export const executeDocumentTool = async (args: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  qaPairs: QaPair[];
}): Promise<ToolResult> => {
  const { toolName, toolInput, toolUseId, orgId, projectId, opportunityId, documentId, qaPairs } = args;

  const start = Date.now();
  let content: string;
  let result: 'success' | 'failure' = 'success';
  let errorMessage: string | undefined;

  try {
    switch (toolName) {
      case 'search_past_performance':
        content = await executePastPerformanceSearch(
          orgId,
          String(toolInput.keywords ?? ''),
          typeof toolInput.limit === 'number' ? toolInput.limit : 3,
        );
        break;

      case 'search_knowledge_base':
        content = await executeKnowledgeBaseSearch(
          orgId,
          String(toolInput.query ?? ''),
          typeof toolInput.limit === 'number' ? toolInput.limit : 3,
        );
        break;

      case 'get_qa_answers':
        content = executeGetQaAnswers(
          qaPairs,
          String(toolInput.topic ?? ''),
          typeof toolInput.limit === 'number' ? toolInput.limit : 5,
        );
        break;

      case 'get_organization_context':
        content = await executeGetOrganizationContext(orgId, projectId);
        break;

      case 'get_executive_brief_analysis':
        content = await fetchExecutiveBriefAnalysis(
          projectId,
          opportunityId,
          toolInput.sections as BriefSectionName[] | undefined,
        );
        if (!content) content = 'No executive brief analysis available for this opportunity.';
        break;

      case 'get_content_library': {
        const clResult = await fetchContentLibraryMatches(
          orgId,
          String(toolInput.query ?? ''),
          typeof toolInput.limit === 'number' ? toolInput.limit : 3,
        );
        content = clResult.content || 'No content library matches found for that query.';
        break;
      }

      case 'get_deadlines':
        content = await fetchDeadlineInfo(projectId, opportunityId);
        if (!content) content = 'No deadline information available for this opportunity.';
        break;

      case 'get_pricing_data':
        content = await fetchPricingData(
          orgId,
          projectId,
          opportunityId,
          toolInput.includeLabor !== false,
          toolInput.includeEstimates !== false,
          toolInput.includeStaffingPlans !== false,
          toolInput.includeBidAnalysis !== false,
        );
        if (!content) content = 'No pricing data available. Create labor rates and cost estimates in the Pricing module first.';
        break;

      case 'search_service_pricing':
        content = await executeSearchServicePricing(toolInput);
        break;

      default:
        content = `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    result = 'failure';
    errorMessage = (err as Error)?.message ?? 'Unknown error';
    content = `Error executing tool "${toolName}": ${errorMessage}`;
    console.error(`Tool "${toolName}" failed:`, errorMessage);
  }

  const durationMs = Date.now() - start;
  console.log(`Tool "${toolName}" executed: ${content.length} chars, ${durationMs}ms`);

  // Non-blocking audit log — never block the critical path
  logToolUsage({
    orgId,
    resourceId: documentId,
    toolName,
    toolInput,
    resultLength: content.length,
    resultEmpty: content.length === 0,
    durationMs,
    result,
    errorMessage,
  }).catch(err => console.warn('Failed to write tool audit log (non-blocking):', (err as Error)?.message));

  return { tool_use_id: toolUseId, content };
};

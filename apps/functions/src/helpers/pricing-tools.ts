import { z } from 'zod';
import { getLaborRatesByOrg, getBOMItemsByOrg, calculateFullyLoadedRate } from './pricing';
import { queryCompanyKnowledgeBase } from './executive-opportunity-brief';
import { loadTextFromS3 } from './s3';
import { requireEnv } from './env';
import { invokeClaudeJson } from './executive-opportunity-brief';
import { ToolDefinition } from '@/types/tool';

// ─── Fuzzy Position Matching ──────────────────────────────────────────────────

/**
 * Normalize a position name for fuzzy matching:
 * - lowercase
 * - remove common filler words (sr, jr, lead, etc.)
 * - collapse whitespace
 * - extract meaningful keywords
 */
const normalizePosition = (position: string): string[] => {
  const lower = position.toLowerCase().trim();
  // Remove common prefixes/suffixes and noise words
  const cleaned = lower
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(sr|jr|senior|junior|lead|principal|staff|chief|associate|i{1,3}|iv|v|level\s*\d+)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.split(' ').filter(w => w.length > 1);
};

/**
 * Calculate similarity score between two position names (0-1).
 * Uses keyword overlap (Jaccard similarity) with seniority bonus.
 */
const positionSimilarity = (requested: string, available: string): number => {
  const reqWords = new Set(normalizePosition(requested));
  const availWords = new Set(normalizePosition(available));

  if (reqWords.size === 0 || availWords.size === 0) return 0;

  // Jaccard similarity on keywords
  let intersection = 0;
  for (const w of reqWords) {
    if (availWords.has(w)) intersection++;
  }
  const union = new Set([...reqWords, ...availWords]).size;
  const jaccard = intersection / union;

  // Seniority match bonus
  const seniorityWords = ['senior', 'junior', 'lead', 'principal', 'staff', 'chief', 'associate', 'sr', 'jr'];
  const reqSeniority = requested.toLowerCase().split(/\s+/).filter(w => seniorityWords.includes(w));
  const availSeniority = available.toLowerCase().split(/\s+/).filter(w => seniorityWords.includes(w));
  const seniorityMatch = reqSeniority.length > 0 && availSeniority.length > 0 &&
    reqSeniority.some(s => availSeniority.includes(s)) ? 0.1 : 0;

  return Math.min(1, jaccard + seniorityMatch);
};

/**
 * Find the best matching position from available rates.
 * Returns the match with score, or null if no good match found.
 */
const findBestPositionMatch = (
  requestedPosition: string,
  availablePositions: string[],
): { position: string; score: number } | null => {
  if (availablePositions.length === 0) return null;

  // First try exact match (case-insensitive)
  const exactMatch = availablePositions.find(
    p => p.toLowerCase().trim() === requestedPosition.toLowerCase().trim(),
  );
  if (exactMatch) return { position: exactMatch, score: 1.0 };

  // Then try fuzzy matching
  let bestMatch: { position: string; score: number } | null = null;
  for (const available of availablePositions) {
    const score = positionSimilarity(requestedPosition, available);
    if (score > (bestMatch?.score ?? 0)) {
      bestMatch = { position: available, score };
    }
  }

  // Only return matches above threshold (0.3 = at least some keyword overlap)
  if (bestMatch && bestMatch.score >= 0.3) return bestMatch;
  return null;
};

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');

export const PRICING_TOOLS: Array<ToolDefinition> = [
  {
    name: 'extract_labor_requirements',
    description: 'Extract labor categories, skill levels, and estimated hours from solicitation text using AI',
    input_schema: {
      type: 'object',
      properties: {
        solicitationText: { type: 'string', description: 'Solicitation text to analyze' },
        focusSection: { type: 'string', description: 'Optional: specific section to focus on (e.g., "Section C", "PWS")' },
      },
      required: ['solicitationText'],
    },
  },
  {
    name: 'extract_contract_value',
    description: 'Extract estimated contract value, ceiling, and period of performance from solicitation using AI',
    input_schema: {
      type: 'object',
      properties: {
        solicitationText: { type: 'string', description: 'Solicitation text to analyze' },
      },
      required: ['solicitationText'],
    },
  },
  {
    name: 'extract_pricing_evaluation_criteria',
    description: 'Extract price/cost evaluation factors and scoring methodology from solicitation using AI',
    input_schema: {
      type: 'object',
      properties: {
        solicitationText: { type: 'string', description: 'Solicitation text to analyze' },
      },
      required: ['solicitationText'],
    },
  },
  {
    name: 'extract_material_requirements',
    description: 'Extract hardware, software, and material requirements from solicitation using AI',
    input_schema: {
      type: 'object',
      properties: {
        solicitationText: { type: 'string', description: 'Solicitation text to analyze' },
        category: { 
          type: 'string', 
          enum: ['HARDWARE', 'SOFTWARE_LICENSE', 'MATERIALS', 'TRAVEL'],
          description: 'Optional: focus on specific category' 
        },
      },
      required: ['solicitationText'],
    },
  },
  {
    name: 'search_historical_pricing',
    description: 'Search knowledge base for historical pricing data from similar contracts',
    input_schema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
        query: { type: 'string', description: 'Search query for similar contracts or pricing data' },
        naicsCode: { type: 'string', description: 'Optional: NAICS code to filter results' },
        contractType: { type: 'string', description: 'Optional: contract type filter' },
      },
      required: ['orgId', 'query'],
    },
  },
  {
    name: 'analyze_incumbent_pricing',
    description: 'Analyze incumbent contractor pricing and performance data from knowledge base',
    input_schema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
        incumbentName: { type: 'string', description: 'Incumbent contractor name' },
        contractNumber: { type: 'string', description: 'Optional: current contract number' },
      },
      required: ['orgId', 'incumbentName'],
    },
  },
  {
    name: 'get_labor_rates',
    description: 'Get all active labor rates for the organization',
    input_schema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
        position: { type: 'string', description: 'Optional: filter by position name' },
      },
      required: ['orgId'],
    },
  },
  {
    name: 'get_bom_items',
    description: 'Get bill of materials items by category',
    input_schema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
        category: { 
          type: 'string', 
          enum: ['HARDWARE', 'SOFTWARE_LICENSE', 'MATERIALS', 'SUBCONTRACTOR', 'TRAVEL', 'ODC'],
          description: 'BOM item category' 
        },
      },
      required: ['orgId'],
    },
  },
  {
    name: 'calculate_labor_cost',
    description: 'Calculate total labor cost for given positions and hours',
    input_schema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
        laborItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              position: { type: 'string' },
              hours: { type: 'number' },
              phase: { type: 'string', description: 'Optional: project phase' },
            },
            required: ['position', 'hours'],
          },
        },
      },
      required: ['orgId', 'laborItems'],
    },
  },
  {
    name: 'analyze_competitive_position',
    description: 'Analyze competitive pricing position based on estimated value and market data',
    input_schema: {
      type: 'object',
      properties: {
        estimatedValue: { type: 'number', description: 'Government estimated contract value' },
        ourPrice: { type: 'number', description: 'Our calculated price' },
        contractType: { type: 'string', description: 'Contract type (FFP, T&M, etc.)' },
        naicsCode: { type: 'string', description: 'NAICS code for market analysis' },
        historicalData: { type: 'string', description: 'Historical pricing data context' },
      },
      required: ['estimatedValue', 'ourPrice'],
    },
  },
];

// ─── AI Extraction Functions ───

const extractLaborRequirementsFromText = async (
  solicitationText: string,
  focusSection?: string
): Promise<Array<{ position: string; skillLevel: string; estimatedHours: number; phase?: string }>> => {
  const extractionSchema = z.object({
    laborRequirements: z.array(z.object({
      position: z.string(),
      skillLevel: z.string(),
      estimatedHours: z.number(),
      phase: z.string().optional(),
      justification: z.string().optional(),
    })),
  });

  const systemPrompt = [
    'Extract labor requirements from government solicitation text.',
    'Focus on: position titles, skill levels, estimated hours, project phases.',
    'Output JSON only with laborRequirements array.',
  ].join('\n');

  const userPrompt = [
    'Extract all labor categories and requirements from this solicitation:',
    focusSection ? `Focus on: ${focusSection}` : '',
    '',
    'SOLICITATION TEXT:',
    solicitationText.slice(0, 20000), // Limit for token efficiency
  ].filter(Boolean).join('\n');

  const result = await invokeClaudeJson({
    modelId: BEDROCK_MODEL_ID,
    system: systemPrompt,
    user: userPrompt,
    outputSchema: extractionSchema,
    maxTokens: 2000,
    temperature: 0.1,
  });

  return result.laborRequirements;
};

const extractContractValueFromText = async (solicitationText: string) => {
  const valueSchema = z.object({
    estimatedValue: z.number().optional(),
    ceilingValue: z.number().optional(),
    periodOfPerformance: z.string().optional(),
    contractType: z.string().optional(),
    currency: z.string().default('USD'),
    valueSource: z.string().optional(),
  });

  const systemPrompt = [
    'Extract contract value and performance period from government solicitation.',
    'Look for: estimated value, ceiling value, IGCE, period of performance.',
    'Output JSON only.',
  ].join('\n');

  const userPrompt = [
    'Extract contract value information from this solicitation:',
    '',
    'SOLICITATION TEXT:',
    solicitationText.slice(0, 15000),
  ].join('\n');

  return await invokeClaudeJson({
    modelId: BEDROCK_MODEL_ID,
    system: systemPrompt,
    user: userPrompt,
    outputSchema: valueSchema,
    maxTokens: 1000,
    temperature: 0.1,
  });
};

const extractPricingEvaluationCriteria = async (solicitationText: string) => {
  const criteriaSchema = z.object({
    evaluationMethod: z.string().optional(),
    priceWeight: z.number().optional(),
    costFactors: z.array(z.string()).default([]),
    pricingInstructions: z.array(z.string()).default([]),
    tradeoffProcess: z.string().optional(),
  });

  const systemPrompt = [
    'Extract pricing evaluation criteria from government solicitation.',
    'Focus on: evaluation method, price weight, cost factors, pricing instructions.',
    'Output JSON only.',
  ].join('\n');

  const userPrompt = [
    'Extract pricing evaluation criteria from this solicitation:',
    'Look for Section M (Evaluation), pricing instructions, cost factors.',
    '',
    'SOLICITATION TEXT:',
    solicitationText.slice(0, 15000),
  ].join('\n');

  return await invokeClaudeJson({
    modelId: BEDROCK_MODEL_ID,
    system: systemPrompt,
    user: userPrompt,
    outputSchema: criteriaSchema,
    maxTokens: 1500,
    temperature: 0.1,
  });
};

const extractMaterialRequirementsFromText = async (
  solicitationText: string,
  category?: string
) => {
  const materialSchema = z.object({
    materials: z.array(z.object({
      name: z.string(),
      category: z.string(),
      quantity: z.number().optional(),
      unit: z.string().optional(),
      specifications: z.string().optional(),
    })),
  });

  const systemPrompt = [
    'Extract material, hardware, and equipment requirements from solicitation.',
    category ? `Focus on ${category} items only.` : 'Extract all material requirements.',
    'Output JSON only with materials array.',
  ].join('\n');

  const userPrompt = [
    'Extract material requirements from this solicitation:',
    '',
    'SOLICITATION TEXT:',
    solicitationText.slice(0, 15000),
  ].join('\n');

  const result = await invokeClaudeJson({
    modelId: BEDROCK_MODEL_ID,
    system: systemPrompt,
    user: userPrompt,
    outputSchema: materialSchema,
    maxTokens: 2000,
    temperature: 0.1,
  });

  return result.materials;
};

export const executePricingTool = async (params: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  executiveBriefId: string;
}): Promise<{ tool_use_id: string; content: string }> => {
  const { toolName, toolInput, toolUseId, orgId } = params;

  try {
    switch (toolName) {
      case 'extract_labor_requirements': {
        const { solicitationText, focusSection } = toolInput;
        
        const laborRequirements = await extractLaborRequirementsFromText(
          solicitationText as string,
          focusSection as string | undefined
        );
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            laborRequirements,
            extractedFrom: focusSection || 'full solicitation',
            count: laborRequirements.length,
          }),
        };
      }

      case 'extract_contract_value': {
        const { solicitationText } = toolInput;
        
        const contractValue = await extractContractValueFromText(solicitationText as string);
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            ...contractValue,
          }),
        };
      }

      case 'extract_pricing_evaluation_criteria': {
        const { solicitationText } = toolInput;
        
        const evaluationCriteria = await extractPricingEvaluationCriteria(solicitationText as string);
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            ...evaluationCriteria,
          }),
        };
      }

      case 'extract_material_requirements': {
        const { solicitationText, category } = toolInput;
        
        const materials = await extractMaterialRequirementsFromText(
          solicitationText as string,
          category as string | undefined
        );
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            materials,
            category: category || 'ALL',
            count: materials.length,
          }),
        };
      }

      case 'search_historical_pricing': {
        const { query, naicsCode, contractType } = toolInput;
        
        // Search KB for historical pricing data
        const kbMatches = await queryCompanyKnowledgeBase(
          orgId,
          `pricing cost estimate ${query} ${naicsCode || ''} ${contractType || ''}`.trim(),
          10
        );
        
        const historicalData = await Promise.all(
          (kbMatches ?? []).slice(0, 5).map(async (m, i) => {
            const text = m.source?.chunkKey
              ? await loadTextFromS3(DOCUMENTS_BUCKET, m.source.chunkKey).catch(() => '')
              : '';
            return {
              score: m.score,
              source: m.source?.documentId || 'unknown',
              snippet: text.slice(0, 500),
              chunkKey: m.source?.chunkKey,
            };
          })
        );
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            historicalData,
            searchQuery: query,
            resultsCount: historicalData.length,
          }),
        };
      }

      case 'analyze_incumbent_pricing': {
        const { incumbentName, contractNumber } = toolInput;
        
        const searchQuery = `${incumbentName} pricing cost contract ${contractNumber || ''}`.trim();
        const kbMatches = await queryCompanyKnowledgeBase(orgId, searchQuery, 8);
        
        const incumbentData = await Promise.all(
          (kbMatches ?? []).slice(0, 3).map(async (m) => {
            const text = m.source?.chunkKey
              ? await loadTextFromS3(DOCUMENTS_BUCKET, m.source.chunkKey).catch(() => '')
              : '';
            return {
              score: m.score,
              source: m.source?.documentId || 'unknown',
              snippet: text.slice(0, 400),
            };
          })
        );
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            incumbentName,
            contractNumber,
            incumbentData,
            dataPoints: incumbentData.length,
          }),
        };
      }

      case 'get_labor_rates': {
        const rates = await getLaborRatesByOrg(orgId);
        const filtered = toolInput.position 
          ? rates.filter(r => r.position.toLowerCase().includes((toolInput.position as string).toLowerCase()))
          : rates;
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            laborRates: filtered.map(r => ({
              position: r.position,
              baseRate: r.baseRate,
              overhead: r.overhead,
              ga: r.ga,
              profit: r.profit,
              fullyLoadedRate: r.fullyLoadedRate,
              rateJustification: r.rateJustification,
              effectiveDate: r.effectiveDate,
            })),
            count: filtered.length,
          }),
        };
      }

      case 'get_bom_items': {
        const items = await getBOMItemsByOrg(orgId, toolInput.category as string);
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            bomItems: items.map(item => ({
              name: item.name,
              category: item.category,
              unitCost: item.unitCost,
              unit: item.unit,
              vendor: item.vendor,
              description: item.description,
              partNumber: item.partNumber,
            })),
            count: items.length,
          }),
        };
      }

      case 'calculate_labor_cost': {
        const laborItems = toolInput.laborItems as Array<{ position: string; hours: number; phase?: string }>;
        const rates = await getLaborRatesByOrg(orgId);
        const activeRates = rates.filter(r => r.isActive);
        const rateMap = new Map(activeRates.map(r => [r.position, r.fullyLoadedRate]));
        const availablePositions = activeRates.map(r => r.position);
        
        const calculations = laborItems.map(item => {
          // Try exact match first
          let rate = rateMap.get(item.position);
          let matchedPosition = item.position;
          let matchType: 'exact' | 'fuzzy' | 'none' = rate !== undefined ? 'exact' : 'none';
          let matchScore = rate !== undefined ? 1.0 : 0;

          // If no exact match, try fuzzy matching
          if (rate === undefined) {
            const fuzzyMatch = findBestPositionMatch(item.position, availablePositions);
            if (fuzzyMatch) {
              rate = rateMap.get(fuzzyMatch.position) ?? 0;
              matchedPosition = fuzzyMatch.position;
              matchType = 'fuzzy';
              matchScore = fuzzyMatch.score;
            } else {
              rate = 0;
            }
          }

          const totalCost = item.hours * rate;
          return {
            requestedPosition: item.position,
            matchedPosition,
            matchType,
            matchScore: Math.round(matchScore * 100) / 100,
            hours: item.hours,
            rate,
            totalCost,
            phase: item.phase,
            found: matchType !== 'none',
          };
        });
        
        const totalLaborCost = calculations.reduce((sum, calc) => sum + calc.totalCost, 0);
        const byPhase = calculations.reduce((acc, calc) => {
          const phase = calc.phase || 'Base Period';
          acc[phase] = (acc[phase] || 0) + calc.totalCost;
          return acc;
        }, {} as Record<string, number>);

        const unmatchedPositions = calculations.filter(c => !c.found);
        const fuzzyMatches = calculations.filter(c => c.matchType === 'fuzzy');
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            calculations,
            totalLaborCost,
            costByPhase: byPhase,
            missingRates: unmatchedPositions.map(c => c.requestedPosition),
            fuzzyMatches: fuzzyMatches.map(c => ({
              requested: c.requestedPosition,
              matched: c.matchedPosition,
              score: c.matchScore,
            })),
            availablePositions,
            hint: unmatchedPositions.length > 0
              ? `${unmatchedPositions.length} position(s) could not be matched. Available positions: ${availablePositions.join(', ')}. Try using exact position names from get_labor_rates.`
              : undefined,
          }),
        };
      }

      case 'analyze_competitive_position': {
        const { estimatedValue, ourPrice, contractType, naicsCode, historicalData } = toolInput;
        
        const estValue = estimatedValue as number;
        const ourPriceNum = ourPrice as number;
        const priceDifference = (ourPriceNum - estValue) / estValue * 100;
        
        // More nuanced competitive position analysis
        let position: 'LOW' | 'COMPETITIVE' | 'HIGH';
        let scoringImplication: string;
        
        if (priceDifference < -15) {
          position = 'LOW';
          scoringImplication = 'Excellent pricing position - should score 4-5 on PRICING_POSITION';
        } else if (priceDifference < -5) {
          position = 'LOW';
          scoringImplication = 'Good pricing position - should score 4 on PRICING_POSITION';
        } else if (priceDifference <= 10) {
          position = 'COMPETITIVE';
          scoringImplication = 'Competitive pricing - should score 3-4 on PRICING_POSITION';
        } else if (priceDifference <= 25) {
          position = 'HIGH';
          scoringImplication = 'Above market pricing - likely scores 2-3 on PRICING_POSITION';
        } else {
          position = 'HIGH';
          scoringImplication = 'Significantly above market - likely scores 1-2 on PRICING_POSITION';
        }
        
        const analysis = {
          competitivePosition: position,
          priceDifferencePercent: Math.round(priceDifference * 100) / 100,
          estimatedValue: estValue,
          ourPrice: ourPriceNum,
          contractType: contractType as string,
          naicsCode: naicsCode as string,
          scoringImplication,
          recommendations: [] as string[],
          winProbabilityFactors: [] as string[],
        };
        
        // Add detailed recommendations and win probability factors
        if (position === 'HIGH') {
          analysis.recommendations.push('Consider reducing scope or optimizing labor mix');
          analysis.recommendations.push('Review overhead and profit margins for reduction opportunities');
          analysis.recommendations.push('Explore subcontracting to reduce costs');
          analysis.recommendations.push('Evaluate value engineering opportunities');
          analysis.winProbabilityFactors.push('Price disadvantage may hurt competitiveness');
          analysis.winProbabilityFactors.push('Need strong technical/past performance differentiation');
        } else if (position === 'LOW') {
          analysis.recommendations.push('Verify cost completeness - ensure no missing elements');
          analysis.recommendations.push('Consider increasing profit margin if justified by value');
          analysis.recommendations.push('Review for potential underestimation of complexity');
          analysis.winProbabilityFactors.push('Strong price advantage increases win probability');
          analysis.winProbabilityFactors.push('Ensure technical solution quality matches low price');
        } else {
          analysis.recommendations.push('Maintain current pricing strategy');
          analysis.recommendations.push('Focus on technical and past performance differentiation');
          analysis.winProbabilityFactors.push('Competitive pricing allows focus on technical merit');
          analysis.winProbabilityFactors.push('Price will not be a significant advantage or disadvantage');
        }
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            ...analysis,
          }),
        };
      }

      default:
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({ error: `Unknown pricing tool: ${toolName}` }),
        };
    }
  } catch (err) {
    return {
      tool_use_id: toolUseId,
      content: JSON.stringify({ 
        error: `Pricing tool error: ${(err as Error)?.message}` 
      }),
    };
  }
};
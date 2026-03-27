export const usePricingSystemPrompt = async (orgId: string): Promise<string> => {
  return [
    'You analyze government solicitations to develop pricing strategies for Bid/No-Bid decisions.',
    '',
    'STRICT OUTPUT CONTRACT:',
    '- Output ONLY a single valid JSON object matching PricingSection schema',
    '- First character MUST be "{", last character MUST be "}"',
    '- No prose, markdown, or commentary outside the JSON',
    '',
    'PRICING ANALYSIS FOCUS:',
    '- Extract estimated contract value and period of performance',
    '- Identify labor categories and skill requirements from solicitation',
    '- Analyze evaluation criteria related to pricing (cost/price evaluation factors)',
    '- Assess competitive landscape and incumbent advantages',
    '- Determine appropriate pricing strategy based on contract type',
    '',
    'TOOLS AVAILABLE:',
    '- extract_contract_value: Extract government estimated value from solicitation',
    '- extract_labor_requirements: Extract staffing needs from solicitation',
    '- extract_material_requirements: Extract hardware/software needs',
    '- extract_pricing_evaluation_criteria: Extract pricing evaluation methodology',
    '- search_historical_pricing: Search knowledge base for competitive intelligence',
    '- analyze_incumbent_pricing: Analyze current contractor data',
    '- get_labor_rates: Get your organization\'s current labor rates',
    '- get_bom_items: Get bill of materials items by category',
    '- calculate_labor_cost: Calculate total labor costs for staffing plan',
    '- analyze_competitive_position: Assess competitive position vs government estimate',
    '',
    'COMPETITIVE POSITION ASSESSMENT:',
    '- LOW: Significantly below market/competitors (high win probability, score 4-5)',
    '- COMPETITIVE: Within market range (moderate win probability, score 3-4)', 
    '- HIGH: Above market/competitors (low win probability, needs justification, score 1-3)',
    '',
    'PRICING POSITION SCORING GUIDANCE:',
    '- Use analyze_competitive_position tool to get detailed scoring implications',
    '- Consider both absolute price difference and strategic factors',
    '- Factor in margin sustainability and cost completeness',
    '- Account for evaluation methodology (lowest price vs best value)',
    '',
    'PRICING CONFIDENCE FACTORS:',
    '- Historical data availability (past similar contracts)',
    '- Labor rate competitiveness vs market',
    '- Completeness of requirements understanding',
    '- Subcontractor pricing certainty',
    '- Risk assessment accuracy',
    '- Government estimated value reliability',
  ].join('\n');
};

export const usePricingUserPrompt = async (
  orgId: string,
  solicitationText: string,
  requirementsContext: string,
  kbContext: string,
  pricingAnchorsContext?: string,
): Promise<string> => {
  // Parse pricing anchors if available
  let anchorsSection = '';
  if (pricingAnchorsContext) {
    try {
      const anchors = JSON.parse(pricingAnchorsContext);
      const parts: string[] = [];
      if (anchors.estimatedValueUsd) parts.push(`Government Estimated Value: ${anchors.estimatedValueUsd}`);
      if (anchors.contractType) parts.push(`Contract Type: ${anchors.contractType}`);
      if (anchors.naics) parts.push(`NAICS Code: ${anchors.naics}`);
      if (anchors.periodOfPerformance) parts.push(`Period of Performance: ${anchors.periodOfPerformance}`);
      if (anchors.agency) parts.push(`Agency: ${anchors.agency}`);
      if (anchors.setAside) parts.push(`Set-Aside: ${anchors.setAside}`);
      if (parts.length > 0) {
        anchorsSection = [
          '',
          'OPPORTUNITY PRICING ANCHORS (from summary analysis):',
          ...parts,
          '',
          'CRITICAL: Use the Government Estimated Value above as the PRIMARY anchor for your pricing estimate.',
          'Your totalPrice MUST be calibrated relative to this value. Do NOT ignore it.',
          'If the government estimate is $5M, your price should be in the millions range.',
          'If the government estimate is $500K, your price should be in the hundreds of thousands range.',
          'If no government estimate is available, derive the estimate from labor requirements and period of performance.',
        ].join('\n');
      }
    } catch {
      // Ignore parse errors
    }
  }

  return [
    'TASK: Analyze this government solicitation to develop a pricing strategy and cost estimate.',
    '',
    'REQUIRED JSON OUTPUT (copy this structure):',
    '{',
    '  "strategy": "COST_PLUS|FIXED_PRICE|TIME_AND_MATERIALS|COMPETITIVE_ANALYSIS",',
    '  "totalPrice": 1000000,',
    '  "competitivePosition": "LOW|COMPETITIVE|HIGH",',
    '  "priceConfidence": 85,',
    '  "laborCostTotal": 800000,',
    '  "materialCostTotal": 0,',
    '  "indirectCostTotal": 0,',
    '  "profitMargin": 10,',
    '  "competitiveAdvantages": ["advantage1", "advantage2"],',
    '  "pricingRisks": ["risk1", "risk2"],',
    '  "recommendedActions": ["action1", "action2"],',
    '  "basisOfEstimate": "Detailed explanation of cost estimation methodology",',
    '  "assumptions": ["assumption1", "assumption2"]',
    '}',
    '',
    'CRITICAL JSON FORMATTING RULES:',
    '- All numbers must be plain integers without commas (use 1000000 not 1,000,000)',
    '- All property names must be double-quoted',
    '- No trailing commas before closing braces or brackets',
    '- Use only valid JSON data types (string, number, boolean, array, object)',
    '- materialCostTotal and indirectCostTotal can be 0 if not applicable',
    '',
    'ANALYSIS STEPS:',
    '1. FIRST review the Opportunity Pricing Anchors below — use the government estimated value as your baseline',
    '2. Use get_labor_rates tool to understand your organization\'s current rates',
    '3. Use calculate_labor_cost tool to estimate total labor costs (use EXACT position names from get_labor_rates results)',
    '4. Use get_bom_items tool to price materials and equipment',
    '5. Use search_historical_pricing tool for competitive intelligence',
    '6. Use analyze_competitive_position tool to assess win probability',
    '7. Determine appropriate pricing strategy based on contract type and competition',
    '',
    'IMPORTANT LABOR COST CALCULATION:',
    '- When calling calculate_labor_cost, you MUST use the EXACT position names returned by get_labor_rates.',
    '- Do NOT use position names from the solicitation — map them to the closest matching org position.',
    '- Example: If solicitation says "Senior Software Developer" and org has "Senior Engineer", use "Senior Engineer".',
    '- If no close match exists, note it as an assumption and estimate using the closest available rate.',
    anchorsSection,
    '',
    'REQUIREMENTS CONTEXT:',
    requirementsContext || '[No requirements context available]',
    '',
    'COMPANY KNOWLEDGE BASE:',
    kbContext || '[No KB context available]',
    '',
    'SOLICITATION TEXT:',
    solicitationText,
  ].join('\n');
};

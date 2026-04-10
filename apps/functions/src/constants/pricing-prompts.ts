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
    '- Use the government estimated value as your PRIMARY pricing anchor',
    '- Identify labor categories from the solicitation and match to provided org rates',
    '- Estimate labor hours per category based on period of performance and scope',
    '- Calculate total labor cost = sum(hours × rate) for each category',
    '- Add materials, indirect costs, and profit margin',
    '- Assess competitive position relative to government estimate',
    '',
    'COMPETITIVE POSITION RULES:',
    '- LOW: Your price is 10%+ below government estimate (high win probability)',
    '- COMPETITIVE: Your price is within ±10% of government estimate',
    '- HIGH: Your price is 10%+ above government estimate (lower win probability)',
    '',
    'PRICING CONFIDENCE FACTORS:',
    '- Availability of government estimated value (high impact)',
    '- Match quality between solicitation roles and org labor rates',
    '- Clarity of scope and period of performance',
    '- Material/equipment requirements specificity',
  ].join('\n');
};

export const usePricingUserPrompt = async (
  orgId: string,
  solicitationText: string,
  requirementsContext: string,
  kbContext: string,
  pricingAnchorsContext?: string,
): Promise<string> => {
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
          'CRITICAL: Use the Government Estimated Value as your PRIMARY anchor.',
          'Your totalPrice MUST be calibrated relative to this value.',
        ].join('\n');
      }
    } catch {
      // Ignore parse errors
    }
  }

  return [
    'TASK: Analyze this solicitation and produce a pricing estimate as JSON.',
    '',
    'REQUIRED JSON OUTPUT:',
    '{',
    '  "strategy": "COST_PLUS|FIXED_PRICE|TIME_AND_MATERIALS|COMPETITIVE_ANALYSIS",',
    '  "totalPrice": 1000000,',
    '  "competitivePosition": "LOW|COMPETITIVE|HIGH",',
    '  "priceConfidence": 75,',
    '  "laborCostTotal": 800000,',
    '  "materialCostTotal": 50000,',
    '  "indirectCostTotal": 100000,',
    '  "profitMargin": 10,',
    '  "competitiveAdvantages": ["advantage1"],',
    '  "pricingRisks": ["risk1"],',
    '  "recommendedActions": ["action1"],',
    '  "basisOfEstimate": "Explanation of how costs were estimated",',
    '  "assumptions": ["assumption1"]',
    '}',
    '',
    'JSON RULES:',
    '- Numbers must be plain integers (1000000 not 1,000,000)',
    '- totalPrice = laborCostTotal + materialCostTotal + indirectCostTotal + profit',
    '- profitMargin is a percentage (e.g. 10 for 10%)',
    '- All cost fields must be > 0 if applicable, estimate if unknown',
    '',
    'ANALYSIS APPROACH:',
    '1. Check the pricing anchors below for government estimated value — use as baseline',
    '2. Identify labor categories from the solicitation',
    '3. Match to the organization labor rates provided in the solicitation text section',
    '4. Estimate hours per role based on scope and period of performance',
    '5. Calculate: laborCostTotal = sum(estimated_hours × hourly_rate)',
    '6. Add materials, indirect costs (overhead/G&A), and profit',
    '7. If no government estimate exists, build bottom-up from labor + materials',
    anchorsSection,
    '',
    'REQUIREMENTS CONTEXT:',
    requirementsContext || '[No requirements context available]',
    '',
    'COMPANY KNOWLEDGE BASE:',
    kbContext || '[No KB context available]',
    '',
    'SOLICITATION TEXT (includes org labor rates and BOM items if available):',
    solicitationText,
  ].join('\n');
};

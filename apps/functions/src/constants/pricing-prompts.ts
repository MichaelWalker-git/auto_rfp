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
    '- Use the government estimated value as your PRIMARY pricing anchor IF stated in the solicitation',
    '- If org labor rates are provided, match solicitation labor categories to them',
    '- If org labor rates are NOT provided, state this explicitly in basisOfEstimate and assumptions — do NOT invent specific hourly rates',
    '- Calculate total labor cost = sum(hours × rate) ONLY when rates are available',
    '- Assess competitive position relative to government estimate IF one exists',
    '',
    'COMPETITIVE POSITION RULES:',
    '- LOW: Your price is 10%+ below government estimate (high win probability)',
    '- COMPETITIVE: Your price is within ±10% of government estimate',
    '- HIGH: Your price is 10%+ above government estimate (lower win probability)',
    '- If no government estimate exists, default to COMPETITIVE and explain in basisOfEstimate',
    '',
    'CRITICAL ANTI-HALLUCINATION RULES:',
    '- Do NOT invent specific labor rates (e.g., "$100/hr") unless they are provided in the solicitation text or org rate data',
    '- Do NOT present fabricated dollar amounts as facts — if you must estimate, clearly label as "speculative estimate" in basisOfEstimate and assumptions',
    '- If no pricing data exists (no gov estimate, no org rates, no historical values), set priceConfidence LOW (10-30) and explain why',
    '- If the document is a Sources Sought, Draft SOW, or market research notice (NOT a formal solicitation), acknowledge this in basisOfEstimate — pricing is premature and highly speculative',
    '',
    'PRICE CONFIDENCE CALIBRATION:',
    '- 70-100: Gov estimate available AND org labor rates provided',
    '- 40-69: Gov estimate OR org rates available (not both)',
    '- 15-39: Neither gov estimate nor org rates, but scope is clear',
    '- 0-14: Sources sought / draft SOW with no pricing data at all',
    '',
    'PRICING INSIGHT PRIORITIES:',
    '- Identify the contract type and its risk implications (FFP = contractor risk, T&M = gov risk, etc.)',
    '- Note evaluation methodology if stated (LPTA, best value, trade-off, points-based) and how price is weighted',
    '- Flag price realism or unbalanced pricing analysis requirements — these affect bidding strategy',
    '- Identify CLIN structure and any conditional pricing rules',
    '- Note total contract duration (base + options) for lifecycle pricing',
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
    '  "totalPrice": 0,',
    '  "competitivePosition": "LOW|COMPETITIVE|HIGH",',
    '  "priceConfidence": 50,',
    '  "laborCostTotal": 0,',
    '  "materialCostTotal": 0,',
    '  "indirectCostTotal": 0,',
    '  "profitMargin": 10,',
    '  "competitiveAdvantages": ["advantage1"],',
    '  "pricingRisks": ["risk1"],',
    '  "recommendedActions": ["action1"],',
    '  "basisOfEstimate": "Explanation of how costs were estimated and what data was available or missing",',
    '  "assumptions": ["assumption1"]',
    '}',
    '',
    'JSON RULES:',
    '- Numbers must be plain integers (1000000 not 1,000,000)',
    '- totalPrice = laborCostTotal + materialCostTotal + indirectCostTotal + profit',
    '- profitMargin is a percentage (e.g. 10 for 10%)',
    '- Cost fields may be 0 when no data supports an estimate',
    '',
    'ANALYSIS APPROACH:',
    '1. Determine document type: formal solicitation, sources sought, draft SOW, or other',
    '2. Check for government estimated value — use as baseline if present',
    '3. Check for org labor rates in the text below — use if present',
    '4. If BOTH gov estimate and org rates exist: build detailed bottom-up estimate',
    '5. If ONLY gov estimate exists: anchor to it, note absence of org rates in assumptions',
    '6. If ONLY org rates exist: build bottom-up from labor + materials, note absence of gov estimate',
    '7. If NEITHER exists: provide a rough order-of-magnitude estimate, set priceConfidence to 15-30, clearly label as speculative in basisOfEstimate',
    '8. For sources sought / draft SOW: acknowledge pricing is premature, focus on strategic insights rather than specific dollar amounts',
    '',
    'FOCUS ON INSIGHTS OVER DOLLAR PRECISION:',
    '- What is the contract type and who bears cost risk?',
    '- How is price evaluated (LPTA, best value, points, trade-off)? What weight does cost carry?',
    '- Are there price realism, price reasonableness, or unbalanced pricing requirements?',
    '- What is the CLIN structure? Any conditional pricing rules?',
    '- What is the total contract duration (base + all options)?',
    '- What are the key pricing risks and recommended actions?',
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

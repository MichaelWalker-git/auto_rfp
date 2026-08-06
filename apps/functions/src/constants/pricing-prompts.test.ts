import { usePricingSystemPrompt, usePricingUserPrompt } from './pricing-prompts';

describe('usePricingSystemPrompt content', () => {
  let systemPrompt: string;

  beforeAll(async () => {
    systemPrompt = await usePricingSystemPrompt('org-123');
  });

  it('contains the strict output contract', () => {
    expect(systemPrompt).toContain('STRICT OUTPUT CONTRACT');
    expect(systemPrompt).toContain('PricingSection schema');
  });

  it('keeps the industry mismatch rules', () => {
    expect(systemPrompt).toContain('INDUSTRY MISMATCH RULES');
    expect(systemPrompt).toContain('Set priceConfidence to 20 or lower for industry mismatches');
    expect(systemPrompt).toContain('Set totalPrice to 0 when the company fundamentally cannot perform the work');
  });

  it('excludes buildable COTS requests from industry mismatch treatment', () => {
    expect(systemPrompt).toContain('is NOT an industry mismatch');
    expect(systemPrompt).toContain('PRODUCT-VS-CUSTOM-DEVELOPMENT MISMATCH RULES below');
  });

  it('contains the product-vs-custom-development mismatch rules block', () => {
    expect(systemPrompt).toContain('PRODUCT-VS-CUSTOM-DEVELOPMENT MISMATCH RULES:');
    expect(systemPrompt).toContain('DELIVERY-MODEL DIFFERENCE');
    expect(systemPrompt).toContain('NOT an inability to price');
  });

  it('forbids "cannot be priced" conclusions for product mismatches', () => {
    expect(systemPrompt).toContain('Do NOT conclude the opportunity "cannot be priced"');
    expect(systemPrompt).toContain(
      'do NOT default to a bottom-floor priceConfidence solely because of the mismatch',
    );
  });

  it('requires a build-equivalent level-of-effort estimate', () => {
    expect(systemPrompt).toContain('BUILD-EQUIVALENT LEVEL-OF-EFFORT ESTIMATE');
    expect(systemPrompt).toContain('build the equivalent capability as custom software');
    expect(systemPrompt).toContain('team composition (roles)');
    expect(systemPrompt).toContain('ORGANIZATION LABOR RATES when provided');
  });

  it('still forbids inventing hourly rates when org rates are missing', () => {
    expect(systemPrompt).toContain(
      'note the missing rates — do NOT invent hourly rates',
    );
  });

  it('requires basisOfEstimate to label and caveat the build-equivalent figure', () => {
    expect(systemPrompt).toContain('build-equivalent level-of-effort estimate');
    expect(systemPrompt).toContain('frame the mismatch as a delivery-model difference');
    expect(systemPrompt).toContain('buyer may insist on a pre-built product');
  });

  it('applies normal confidence calibration to build-equivalent estimates', () => {
    expect(systemPrompt).toContain(
      'do NOT force priceConfidence below 30 solely because of the product mismatch',
    );
    expect(systemPrompt).toContain('PRICE CONFIDENCE CALIBRATION');
  });

  it('keeps the anti-hallucination and competitive position rules unchanged', () => {
    expect(systemPrompt).toContain('CRITICAL ANTI-HALLUCINATION RULES');
    expect(systemPrompt).toContain('COMPETITIVE POSITION RULES');
    expect(systemPrompt).toContain('PRICING INSIGHT PRIORITIES');
  });
});

describe('usePricingUserPrompt content', () => {
  it('includes the build-equivalent step in the analysis approach', async () => {
    const userPrompt = await usePricingUserPrompt('org-123', 'solicitation text', '', '');
    expect(userPrompt).toContain('ANALYSIS APPROACH');
    expect(userPrompt).toContain(
      '9. If the buyer requests an off-the-shelf/COTS product but the company delivers custom software development',
    );
    expect(userPrompt).toContain('build-equivalent level-of-effort estimate');
    expect(userPrompt).toContain('delivery-model difference — NOT an inability to price');
  });

  it('keeps the required JSON output shape', async () => {
    const userPrompt = await usePricingUserPrompt('org-123', 'solicitation text', '', '');
    expect(userPrompt).toContain('REQUIRED JSON OUTPUT');
    expect(userPrompt).toContain('"basisOfEstimate"');
    expect(userPrompt).toContain('"priceConfidence"');
  });

  it('renders pricing anchors when provided', async () => {
    const anchors = JSON.stringify({ estimatedValueUsd: 500000, contractType: 'FFP' });
    const userPrompt = await usePricingUserPrompt('org-123', 'text', '', '', anchors);
    expect(userPrompt).toContain('OPPORTUNITY PRICING ANCHORS');
    expect(userPrompt).toContain('Government Estimated Value: 500000');
    expect(userPrompt).toContain('Contract Type: FFP');
  });

  it('omits the anchors section for invalid anchor JSON', async () => {
    const userPrompt = await usePricingUserPrompt('org-123', 'text', '', '', 'not-json');
    expect(userPrompt).not.toContain('OPPORTUNITY PRICING ANCHORS');
  });

  it('includes solicitation, requirements, and KB context placeholders', async () => {
    const userPrompt = await usePricingUserPrompt('org-123', 'the solicitation body', '', '');
    expect(userPrompt).toContain('the solicitation body');
    expect(userPrompt).toContain('[No requirements context available]');
    expect(userPrompt).toContain('[No KB context available]');
  });
});

/**
 * Tests for the search_service_pricing document tool (T3): doc-type filtering
 * via getDocumentToolsForType, the formatted pricing table (source URL +
 * retrieval date per row, ESTIMATES footer), partial-failure rows, and the
 * ADR-15 total-outage degradation (the executor never throws into the tool loop).
 */
process.env.DOCUMENTS_BUCKET = 'test-bucket';

jest.mock('./past-performance', () => ({
  searchPastProjects: jest.fn(),
  getPastProject: jest.fn(),
}));

jest.mock('./executive-opportunity-brief', () => ({
  queryCompanyKnowledgeBase: jest.fn(),
  truncateText: (text: string, max: number) => text.slice(0, max),
}));

jest.mock('./s3', () => ({
  loadTextFromS3: jest.fn(),
}));

const mockLogToolUsage = jest.fn();
jest.mock('./db-tool-helpers', () => ({
  fetchOrganizationDetails: jest.fn(),
  fetchOrgPrimaryContact: jest.fn(),
  fetchProjectDetails: jest.fn(),
  fetchTeamMembers: jest.fn(),
  fetchExecutiveBriefAnalysis: jest.fn(),
  fetchContentLibraryMatches: jest.fn(),
  fetchDeadlineInfo: jest.fn(),
  logToolUsage: (...a: unknown[]) => mockLogToolUsage(...a),
}));

const mockSearchServicePricing = jest.fn();
jest.mock('./service-pricing', () => ({
  searchServicePricing: (...a: unknown[]) => mockSearchServicePricing(...a),
}));

import { DOCUMENT_TOOLS, PRICING_TOOL_DOC_TYPES, executeDocumentTool, getDocumentToolsForType } from './document-tools';

const baseArgs = {
  toolUseId: 'tu-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  documentId: 'doc-1',
  qaPairs: [],
};

const foundResult = {
  serviceName: 'Datadog Pro',
  billingPeriod: 'MONTHLY',
  found: true,
  price: 23,
  currency: 'USD',
  unit: 'per host/month',
  tier: 'Pro',
  sourceUrl: 'https://www.datadoghq.com/pricing/',
  confidence: 'HIGH',
  retrievedAt: '2026-08-14T10:00:00.000Z',
  fromCache: false,
};

const notFoundResult = {
  serviceName: 'Obscure Tool X',
  billingPeriod: 'UNKNOWN',
  found: false,
  fromCache: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLogToolUsage.mockResolvedValue(undefined);
});

describe('getDocumentToolsForType', () => {
  it('offers search_service_pricing for COST_PROPOSAL and PRICE_VOLUME', () => {
    for (const documentType of ['COST_PROPOSAL', 'PRICE_VOLUME']) {
      const names = getDocumentToolsForType(documentType).map((t) => t.name);
      expect(names).toContain('search_service_pricing');
    }
  });

  it('withholds search_service_pricing from all other document types', () => {
    for (const documentType of ['TECHNICAL_PROPOSAL', 'COVER_LETTER', 'EXECUTIVE_SUMMARY']) {
      const names = getDocumentToolsForType(documentType).map((t) => t.name);
      expect(names).not.toContain('search_service_pricing');
    }
  });

  it('keeps every other tool regardless of document type', () => {
    const baseNames = DOCUMENT_TOOLS.map((t) => t.name).filter((n) => n !== 'search_service_pricing');
    expect(getDocumentToolsForType('TECHNICAL_PROPOSAL').map((t) => t.name)).toEqual(baseNames);
    expect(getDocumentToolsForType('COST_PROPOSAL').map((t) => t.name)).toEqual([
      ...baseNames,
      'search_service_pricing',
    ]);
  });

  it('withholds search_service_pricing from pricing types when an Approved Solution Plan exists (Fix A)', () => {
    for (const documentType of ['COST_PROPOSAL', 'PRICE_VOLUME']) {
      const names = getDocumentToolsForType(documentType, { hasSolutionPlan: true }).map((t) => t.name);
      expect(names).not.toContain('search_service_pricing');
    }
  });

  it('keeps offering search_service_pricing to pricing types when no plan exists', () => {
    for (const documentType of ['COST_PROPOSAL', 'PRICE_VOLUME']) {
      expect(getDocumentToolsForType(documentType, { hasSolutionPlan: false }).map((t) => t.name))
        .toContain('search_service_pricing');
      expect(getDocumentToolsForType(documentType, {}).map((t) => t.name))
        .toContain('search_service_pricing');
    }
  });

  it('never offers search_service_pricing to non-pricing types, plan or not', () => {
    for (const hasSolutionPlan of [true, false]) {
      const names = getDocumentToolsForType('TECHNICAL_PROPOSAL', { hasSolutionPlan }).map((t) => t.name);
      expect(names).not.toContain('search_service_pricing');
    }
  });

  it('keeps all other tools intact when the plan withholds the pricing tool', () => {
    const baseNames = DOCUMENT_TOOLS.map((t) => t.name).filter((n) => n !== 'search_service_pricing');
    expect(getDocumentToolsForType('COST_PROPOSAL', { hasSolutionPlan: true }).map((t) => t.name))
      .toEqual(baseNames);
  });

  it('exports PRICING_TOOL_DOC_TYPES covering exactly the pricing documents', () => {
    expect([...PRICING_TOOL_DOC_TYPES].sort()).toEqual(['COST_PROPOSAL', 'PRICE_VOLUME']);
  });

  it('defines the batched input schema (services array, max 10, one call)', () => {
    const tool = DOCUMENT_TOOLS.find((t) => t.name === 'search_service_pricing');
    expect(tool?.input_schema.required).toEqual(['services']);
    expect(tool?.description).toContain('ONE call');
    const servicesProp = tool?.input_schema.properties.services as { maxItems: number };
    expect(servicesProp.maxItems).toBe(10);
  });
});

describe('executeDocumentTool — search_service_pricing', () => {
  it('returns one table row per service with source URL, retrieval date, and ESTIMATES footer', async () => {
    mockSearchServicePricing.mockResolvedValue([foundResult, notFoundResult]);

    const result = await executeDocumentTool({
      ...baseArgs,
      toolName: 'search_service_pricing',
      toolInput: {
        services: [
          { serviceName: 'Datadog Pro', billingPeriod: 'MONTHLY' },
          { serviceName: 'Obscure Tool X' },
        ],
      },
    });

    expect(mockSearchServicePricing).toHaveBeenCalledWith({
      services: [
        { serviceName: 'Datadog Pro', billingPeriod: 'MONTHLY' },
        { serviceName: 'Obscure Tool X' },
      ],
    });
    expect(result.tool_use_id).toBe('tu-1');
    expect(result.content).toContain('1 of 2 service(s) priced');
    expect(result.content).toContain(
      '| Datadog Pro | MONTHLY | 23 USD per host/month | Pro | HIGH | https://www.datadoghq.com/pricing/ | 2026-08-14 |',
    );
    expect(result.content).toContain('ESTIMATES — subject to vendor quote');
    // Fix A: source URLs stay internal — the model must not print them in the document
    expect(result.content).toContain('Do NOT print the Source URLs');
    expect(result.content).not.toContain("cite each price's Source URL");
  });

  it('renders failed lookups as "vendor quote required" rows (partial failure)', async () => {
    mockSearchServicePricing.mockResolvedValue([foundResult, notFoundResult]);

    const { content } = await executeDocumentTool({
      ...baseArgs,
      toolName: 'search_service_pricing',
      toolInput: {
        services: [{ serviceName: 'Datadog Pro' }, { serviceName: 'Obscure Tool X' }],
      },
    });

    expect(content).toContain('| Obscure Tool X | UNKNOWN | vendor quote required | — | — | — | — |');
    // The plain "vendor quote required" row must not carry the outage suffix
    expect(content).not.toContain('lookup unavailable');
  });

  it('degrades ALL rows to "vendor quote required (lookup unavailable)" on total outage (ADR-15)', async () => {
    mockSearchServicePricing.mockRejectedValue(new Error('SSM key missing'));

    const result = await executeDocumentTool({
      ...baseArgs,
      toolName: 'search_service_pricing',
      toolInput: {
        services: [
          { serviceName: 'Datadog Pro', billingPeriod: 'MONTHLY' },
          { serviceName: 'GitHub Enterprise', billingPeriod: 'ANNUAL' },
        ],
      },
    });

    expect(result.content).toContain(
      '| Datadog Pro | MONTHLY | vendor quote required (lookup unavailable) | — | — | — | — |',
    );
    expect(result.content).toContain(
      '| GitHub Enterprise | ANNUAL | vendor quote required (lookup unavailable) | — | — | — | — |',
    );
    expect(result.content).toContain('0 of 2 service(s) priced');
    expect(result.content).toContain('ESTIMATES — subject to vendor quote');
    // The outage is absorbed, not surfaced as a tool error
    expect(result.content).not.toContain('Error executing tool');
  });

  it('passes an over-cap batch (>10 services) through to the helper instead of rejecting it', async () => {
    // The executor's Zod schema deliberately has no .max(10): the helper caps
    // the batch and degrades extras to "vendor quote required" rows, which the
    // model handles better than a validation error. Guards against someone
    // "fixing" the schema with .max(10) and breaking that degradation.
    const services = Array.from({ length: 12 }, (_, i) => ({ serviceName: `Service ${i}` }));
    mockSearchServicePricing.mockResolvedValue(
      services.map((s, i) =>
        i < 10
          ? { ...foundResult, serviceName: s.serviceName }
          : { ...notFoundResult, serviceName: s.serviceName },
      ),
    );

    const { content } = await executeDocumentTool({
      ...baseArgs,
      toolName: 'search_service_pricing',
      toolInput: { services },
    });

    expect(mockSearchServicePricing).toHaveBeenCalledWith({ services });
    expect(content).not.toContain('Invalid search_service_pricing input');
    expect(content).toContain('10 of 12 service(s) priced');
    expect(content).toContain('| Service 11 | UNKNOWN | vendor quote required | — | — | — | — |');
  });

  it('returns an instructive message (not an error) for invalid input', async () => {
    const { content } = await executeDocumentTool({
      ...baseArgs,
      toolName: 'search_service_pricing',
      toolInput: { services: [] },
    });

    expect(mockSearchServicePricing).not.toHaveBeenCalled();
    expect(content).toContain('Invalid search_service_pricing input');
    expect(content).toContain('"services"');
  });

  it('a found result without a price still renders as vendor quote required', async () => {
    mockSearchServicePricing.mockResolvedValue([
      { ...notFoundResult, serviceName: 'Datadog Pro', billingPeriod: 'MONTHLY' },
    ]);

    const { content } = await executeDocumentTool({
      ...baseArgs,
      toolName: 'search_service_pricing',
      toolInput: { services: [{ serviceName: 'Datadog Pro', billingPeriod: 'MONTHLY' }] },
    });

    expect(content).toContain('| Datadog Pro | MONTHLY | vendor quote required | — | — | — | — |');
  });

  it('writes a tool-usage audit log entry', async () => {
    mockSearchServicePricing.mockResolvedValue([foundResult]);

    await executeDocumentTool({
      ...baseArgs,
      toolName: 'search_service_pricing',
      toolInput: { services: [{ serviceName: 'Datadog Pro' }] },
    });

    expect(mockLogToolUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'search_service_pricing',
        orgId: 'org-1',
        resourceId: 'doc-1',
        result: 'success',
      }),
    );
  });
});

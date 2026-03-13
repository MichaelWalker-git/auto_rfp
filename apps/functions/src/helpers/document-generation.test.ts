// Mock dependencies BEFORE imports
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234'),
}));
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: jest.fn((handler: unknown) => handler),
}));
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(() => ({ before: jest.fn() })),
  httpErrorMiddleware: jest.fn(() => ({ onError: jest.fn() })),
  orgMembershipMiddleware: jest.fn(() => ({ before: jest.fn() })),
  requirePermission: jest.fn(() => ({ before: jest.fn() })),
}));
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ after: jest.fn() })),
  setAuditContext: jest.fn(),
}));
jest.mock('./project');
jest.mock('@/handlers/organization/get-organization-by-id');
jest.mock('./opportunity');
jest.mock('./rfp-document');
jest.mock('./rfp-document-version');
jest.mock('./db');
jest.mock('./executive-opportunity-brief', () => ({
  loadAllSolicitationTexts: jest.fn(),
  getExecutiveBriefByProjectId: jest.fn(),
}));
jest.mock('./template', () => ({
  getTemplate: jest.fn(),
  listTemplatesByOrg: jest.fn(),
  loadTemplateHtml: jest.fn(),
  replaceMacros: jest.fn((text: string, macros: Record<string, string>) => {
    let result = text;
    Object.entries(macros).forEach(([key, value]) => {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    });
    return result;
  }),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { buildMacroValues, prepareTemplateScaffoldForAI } from './document-generation';
import { getProjectById } from './project';
import { getOrganizationById } from '@/handlers/organization/get-organization-by-id';
import { getOpportunity } from './opportunity';
import { getExecutiveBriefByProjectId } from './executive-opportunity-brief';

const mockGetProjectById = getProjectById as jest.MockedFunction<typeof getProjectById>;
const mockGetOrganizationById = getOrganizationById as jest.MockedFunction<typeof getOrganizationById>;
const mockGetOpportunity = getOpportunity as jest.MockedFunction<typeof getOpportunity>;
const mockGetExecutiveBriefByProjectId = getExecutiveBriefByProjectId as jest.MockedFunction<typeof getExecutiveBriefByProjectId>;

describe('buildMacroValues', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should build macro values from org, project, and opportunity data', async () => {
    const mockOrg = {
      id: 'org-123',
      name: 'Acme Corporation',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    const mockProject = {
      id: 'proj-456',
      orgId: 'org-123',
      name: 'Federal Contract XYZ',
      description: 'Modernization project for federal systems',
      partition_key: 'PROJECT',
      sort_key: 'org-123#proj-456',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    const mockOpportunity = {
      id: 'opp-789',
      oppId: 'opp-789',
      title: 'Federal Cloud Services Contract',
      noticeId: 'SAM-2024-12345',
      solicitationNumber: 'W911NF-24-R-0001',
      organizationName: 'Department of Defense',
      naicsCode: '541512',
      pscCode: 'D302',
      setAside: 'Total Small Business Set-Aside',
      type: 'Combined Synopsis/Solicitation',
      responseDeadlineIso: '2024-12-31T23:59:59Z',
      baseAndAllOptionsValue: 5000000,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    mockGetOrganizationById.mockResolvedValue(mockOrg as any);
    mockGetProjectById.mockResolvedValue(mockProject as any);
    mockGetOpportunity.mockResolvedValue({ item: mockOpportunity as any, oppId: 'opp-789' });

    const result = await buildMacroValues({
      orgId: 'org-123',
      projectId: 'proj-456',
      opportunityId: 'opp-789',
    });

    expect(result).toMatchObject({
      COMPANY_NAME: 'Acme Corporation',
      PROJECT_TITLE: 'Federal Contract XYZ',
      PROPOSAL_TITLE: 'Federal Contract XYZ',
      PROJECT_DESCRIPTION: 'Modernization project for federal systems',
      OPPORTUNITY_ID: 'opp-789',
      OPPORTUNITY_TITLE: 'Federal Cloud Services Contract',
      NOTICE_ID: 'SAM-2024-12345',
      SOLICITATION_NUMBER: 'W911NF-24-R-0001',
      AGENCY_NAME: 'Department of Defense',
      ISSUING_OFFICE: 'Department of Defense',
      NAICS_CODE: '541512',
      PSC_CODE: 'D302',
      SET_ASIDE: 'Total Small Business Set-Aside',
      OPPORTUNITY_TYPE: 'Combined Synopsis/Solicitation',
      ESTIMATED_VALUE: '$5,000,000',
      BASE_AND_OPTIONS_VALUE: '$5,000,000',
    });

    expect(result.TODAY).toMatch(/^\d{4}-\d{2}-\d{2}$/); // YYYY-MM-DD format
    expect(result.CURRENT_YEAR).toMatch(/^\d{4}$/);
    // Date formatting is timezone-dependent; just verify it's a non-empty string
    expect(result.RESPONSE_DEADLINE).toBeDefined();
    expect(result.RESPONSE_DEADLINE.length).toBeGreaterThan(0);
    expect(result.SUBMISSION_DATE).toBe(result.RESPONSE_DEADLINE); // Alias for RESPONSE_DEADLINE
    expect(result.CONTENT).toContain('[CONTENT:');
  });

  it('should handle missing optional data gracefully', async () => {
    const mockOrg = {
      id: 'org-123',
      name: 'Acme Corporation',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    const mockProject = {
      id: 'proj-456',
      orgId: 'org-123',
      name: 'Federal Contract XYZ',
      partition_key: 'PROJECT',
      sort_key: 'org-123#proj-456',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    mockGetOrganizationById.mockResolvedValue(mockOrg as any);
    mockGetProjectById.mockResolvedValue(mockProject as any);
    mockGetOpportunity.mockResolvedValue(undefined);

    const result = await buildMacroValues({
      orgId: 'org-123',
      projectId: 'proj-456',
    });

    expect(result).toMatchObject({
      COMPANY_NAME: 'Acme Corporation',
      PROJECT_TITLE: 'Federal Contract XYZ',
      PROPOSAL_TITLE: 'Federal Contract XYZ',
    });

    // Optional opportunity fields should be empty or not present
    expect(result.OPPORTUNITY_ID).toBeUndefined();
    expect(result.SOLICITATION_NUMBER).toBeUndefined();
  });

  it('should handle null organization data', async () => {
    const mockProject = {
      id: 'proj-456',
      orgId: 'org-123',
      name: 'Federal Contract XYZ',
      partition_key: 'PROJECT',
      sort_key: 'org-123#proj-456',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    mockGetOrganizationById.mockResolvedValue(null);
    mockGetProjectById.mockResolvedValue(mockProject as any);
    mockGetOpportunity.mockResolvedValue(undefined);

    const result = await buildMacroValues({
      orgId: 'org-123',
      projectId: 'proj-456',
    });

    expect(result.COMPANY_NAME).toBeUndefined();
    expect(result.PROJECT_TITLE).toBe('Federal Contract XYZ');
  });

  it('should handle null project data', async () => {
    const mockOrg = {
      id: 'org-123',
      name: 'Acme Corporation',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    mockGetOrganizationById.mockResolvedValue(mockOrg as any);
    mockGetProjectById.mockResolvedValue(null);
    mockGetOpportunity.mockResolvedValue(undefined);

    const result = await buildMacroValues({
      orgId: 'org-123',
      projectId: 'proj-456',
    });

    expect(result.COMPANY_NAME).toBe('Acme Corporation');
    expect(result.PROJECT_TITLE).toBeUndefined();
    expect(result.TODAY).toBeDefined();
  });

  it('should include project contact info macros', async () => {
    const mockProject = {
      id: 'proj-123',
      orgId: 'org-123',
      name: 'Test Project',
      partition_key: 'PROJECT',
      sort_key: 'org-123#proj-123',
      contactInfo: {
        primaryPocName: 'John Smith',
        primaryPocEmail: 'john@example.com',
        primaryPocPhone: '+1-555-1234',
        primaryPocTitle: 'Proposal Manager',
      },
    };

    mockGetOrganizationById.mockResolvedValue({ id: 'org-123', name: 'Test Org' } as any);
    mockGetProjectById.mockResolvedValue(mockProject as any);
    mockGetOpportunity.mockResolvedValue(undefined);

    const result = await buildMacroValues({
      orgId: 'org-123',
      projectId: 'proj-123',
    });

    expect(result.PROJECT_POC_NAME).toBe('John Smith');
    expect(result.PROJECT_POC_EMAIL).toBe('john@example.com');
    expect(result.PROJECT_POC_PHONE).toBe('+1-555-1234');
    expect(result.PROJECT_POC_TITLE).toBe('Proposal Manager');
  });

  it('should return empty strings for missing project contact info', async () => {
    const mockProject = {
      id: 'proj-123',
      orgId: 'org-123',
      name: 'Test Project',
      partition_key: 'PROJECT',
      sort_key: 'org-123#proj-123',
      // no contactInfo
    };

    mockGetOrganizationById.mockResolvedValue({ id: 'org-123', name: 'Test Org' } as any);
    mockGetProjectById.mockResolvedValue(mockProject as any);
    mockGetOpportunity.mockResolvedValue(undefined);

    const result = await buildMacroValues({
      orgId: 'org-123',
      projectId: 'proj-123',
    });

    expect(result.PROJECT_POC_NAME).toBe('');
    expect(result.PROJECT_POC_EMAIL).toBe('');
    expect(result.PROJECT_POC_PHONE).toBe('');
    expect(result.PROJECT_POC_TITLE).toBe('');
  });

  it('should include solicitation org macros from opportunity', async () => {
    const mockOpportunity = {
      id: 'opp-123',
      title: 'Test Opportunity',
      organizationName: 'Department of Defense',
      source: 'SAM_GOV',
      type: null,
      postedDateIso: null,
      responseDeadlineIso: null,
      noticeId: null,
      solicitationNumber: null,
      naicsCode: null,
      pscCode: null,
      setAside: null,
      description: null,
      baseAndAllOptionsValue: null,
    };

    mockGetOrganizationById.mockResolvedValue({ id: 'org-123', name: 'Test Org' } as any);
    mockGetProjectById.mockResolvedValue({ id: 'proj-123', orgId: 'org-123', name: 'Test' } as any);
    mockGetOpportunity.mockResolvedValue({ item: mockOpportunity as any, oppId: 'opp-123' });
    mockGetExecutiveBriefByProjectId.mockRejectedValue(new Error('Not found'));

    const result = await buildMacroValues({
      orgId: 'org-123',
      projectId: 'proj-123',
      opportunityId: 'opp-123',
    });

    expect(result.SOLICITATION_ORG_NAME).toBe('Department of Defense');
    expect(result.SOLICITATION_ORG_OFFICE).toBe('Department of Defense');
  });

  it('should include solicitation org details from executive brief summary', async () => {
    const mockOpportunity = {
      id: 'opp-123',
      title: 'Test Opportunity',
      organizationName: 'Department of Defense',
      source: 'SAM_GOV',
      type: null,
      postedDateIso: null,
      responseDeadlineIso: null,
      noticeId: null,
      solicitationNumber: null,
      naicsCode: null,
      pscCode: null,
      setAside: null,
      description: null,
      baseAndAllOptionsValue: null,
    };

    const mockBrief = {
      sections: {
        summary: {
          status: 'COMPLETE',
          data: {
            agency: 'Department of Defense',
            office: 'Naval Supply Systems Command',
            placeOfPerformance: 'Washington, DC',
            summary: 'Test summary content here.',
          },
        },
        contacts: {
          status: 'COMPLETE',
          data: {
            contacts: [
              { role: 'CONTRACTING_OFFICER', name: 'Jane Doe', email: 'jane.doe@navy.mil' },
              { role: 'TECHNICAL_POC', name: 'Bob Johnson', email: 'bob@navy.mil' },
              { role: 'PROGRAM_MANAGER', name: 'Alice Brown', email: 'alice@navy.mil' },
            ],
          },
        },
      },
    };

    mockGetOrganizationById.mockResolvedValue({ id: 'org-123', name: 'Test Org' } as any);
    mockGetProjectById.mockResolvedValue({ id: 'proj-123', orgId: 'org-123', name: 'Test' } as any);
    mockGetOpportunity.mockResolvedValue({ item: mockOpportunity as any, oppId: 'opp-123' });
    mockGetExecutiveBriefByProjectId.mockResolvedValue(mockBrief as any);

    const result = await buildMacroValues({
      orgId: 'org-123',
      projectId: 'proj-123',
      opportunityId: 'opp-123',
    });

    // Solicitation org from brief summary
    expect(result.SOLICITATION_ORG_NAME).toBe('Department of Defense');
    expect(result.SOLICITATION_ORG_OFFICE).toBe('Naval Supply Systems Command');
    expect(result.SOLICITATION_ORG_LOCATION).toBe('Washington, DC');

    // Brief contacts
    expect(result.CONTRACTING_OFFICER).toBe('Jane Doe (jane.doe@navy.mil)');
    expect(result.TECHNICAL_POC).toBe('Bob Johnson (bob@navy.mil)');
  });

  it('should handle missing brief contacts gracefully', async () => {
    const mockOpportunity = {
      id: 'opp-123',
      title: 'Test Opportunity',
      organizationName: 'DoD',
      source: 'SAM_GOV',
      type: null,
      postedDateIso: null,
      responseDeadlineIso: null,
      noticeId: null,
      solicitationNumber: null,
      naicsCode: null,
      pscCode: null,
      setAside: null,
      description: null,
      baseAndAllOptionsValue: null,
    };

    const mockBrief = {
      sections: {
        summary: { status: 'COMPLETE', data: { summary: 'Test summary.' } },
        contacts: { status: 'COMPLETE', data: { contacts: [] } },
      },
    };

    mockGetOrganizationById.mockResolvedValue({ id: 'org-123', name: 'Test Org' } as any);
    mockGetProjectById.mockResolvedValue({ id: 'proj-123', orgId: 'org-123', name: 'Test' } as any);
    mockGetOpportunity.mockResolvedValue({ item: mockOpportunity as any, oppId: 'opp-123' });
    mockGetExecutiveBriefByProjectId.mockResolvedValue(mockBrief as any);

    const result = await buildMacroValues({
      orgId: 'org-123',
      projectId: 'proj-123',
      opportunityId: 'opp-123',
    });

    // Should not have brief contact macros when contacts array is empty
    expect(result.CONTRACTING_OFFICER).toBeUndefined();
    expect(result.TECHNICAL_POC).toBeUndefined();
  });

  it('should handle executive brief fetch failure gracefully', async () => {
    const mockOpportunity = {
      id: 'opp-123',
      title: 'Test Opportunity',
      organizationName: 'DoD',
      source: 'SAM_GOV',
      type: null,
      postedDateIso: null,
      responseDeadlineIso: null,
      noticeId: null,
      solicitationNumber: null,
      naicsCode: null,
      pscCode: null,
      setAside: null,
      description: null,
      baseAndAllOptionsValue: null,
    };

    mockGetOrganizationById.mockResolvedValue({ id: 'org-123', name: 'Test Org' } as any);
    mockGetProjectById.mockResolvedValue({ id: 'proj-123', orgId: 'org-123', name: 'Test' } as any);
    mockGetOpportunity.mockResolvedValue({ item: mockOpportunity as any, oppId: 'opp-123' });
    mockGetExecutiveBriefByProjectId.mockRejectedValue(new Error('Brief not found'));

    // Should not throw — brief fetch failure is handled gracefully
    const result = await buildMacroValues({
      orgId: 'org-123',
      projectId: 'proj-123',
      opportunityId: 'opp-123',
    });

    expect(result.SOLICITATION_ORG_NAME).toBe('DoD');
    expect(result.CONTRACTING_OFFICER).toBeUndefined();
    expect(result.TECHNICAL_POC).toBeUndefined();
  });

  it('should format brief contact with name only', async () => {
    const mockOpportunity = {
      id: 'opp-123',
      title: 'Test',
      organizationName: 'DoD',
      source: 'SAM_GOV',
      type: null,
      postedDateIso: null,
      responseDeadlineIso: null,
      noticeId: null,
      solicitationNumber: null,
      naicsCode: null,
      pscCode: null,
      setAside: null,
      description: null,
      baseAndAllOptionsValue: null,
    };

    const mockBrief = {
      sections: {
        summary: { status: 'COMPLETE', data: { summary: 'Test.' } },
        contacts: {
          status: 'COMPLETE',
          data: {
            contacts: [
              { role: 'CONTRACTING_OFFICER', name: 'Jane Doe', email: null },
              { role: 'TECHNICAL_POC', name: null, email: 'bob@navy.mil' },
            ],
          },
        },
      },
    };

    mockGetOrganizationById.mockResolvedValue({ id: 'org-123', name: 'Test Org' } as any);
    mockGetProjectById.mockResolvedValue({ id: 'proj-123', orgId: 'org-123', name: 'Test' } as any);
    mockGetOpportunity.mockResolvedValue({ item: mockOpportunity as any, oppId: 'opp-123' });
    mockGetExecutiveBriefByProjectId.mockResolvedValue(mockBrief as any);

    const result = await buildMacroValues({
      orgId: 'org-123',
      projectId: 'proj-123',
      opportunityId: 'opp-123',
    });

    expect(result.CONTRACTING_OFFICER).toBe('Jane Doe');
    expect(result.TECHNICAL_POC).toBe('(bob@navy.mil)');
  });
});

describe('prepareTemplateScaffoldForAI', () => {
  it('should replace macros with real values when provided', () => {
    const template = `
      <h1>Proposal for {{PROJECT_TITLE}}</h1>
      <p>Submitted by: {{COMPANY_NAME}}</p>
      <p>Solicitation: {{SOLICITATION_NUMBER}}</p>
      <p>Date: {{TODAY}}</p>
    `;

    const macroValues = {
      PROJECT_TITLE: 'Federal Contract XYZ',
      COMPANY_NAME: 'Acme Corporation',
      SOLICITATION_NUMBER: 'W911NF-24-R-0001',
      TODAY: '2024-03-15',
    };

    const result = prepareTemplateScaffoldForAI(template, macroValues);

    expect(result).toContain('Federal Contract XYZ');
    expect(result).toContain('Acme Corporation');
    expect(result).toContain('W911NF-24-R-0001');
    expect(result).toContain('2024-03-15');
    expect(result).not.toContain('{{PROJECT_TITLE}}');
    expect(result).not.toContain('{{COMPANY_NAME}}');
  });

  it('should replace unresolved macros with placeholder labels', () => {
    const template = `
      <h1>Proposal for {{PROJECT_TITLE}}</h1>
      <p>Agency: {{AGENCY_NAME}}</p>
    `;

    const macroValues = {
      PROJECT_TITLE: 'Federal Contract XYZ',
      // AGENCY_NAME not provided
    };

    const result = prepareTemplateScaffoldForAI(template, macroValues);

    expect(result).toContain('Federal Contract XYZ');
    expect(result).toContain('[Agency/Customer Name]'); // Fallback label
    expect(result).not.toContain('{{AGENCY_NAME}}');
  });

  it('should use placeholder labels when no macro values provided', () => {
    const template = `
      <h1>Proposal for {{PROJECT_TITLE}}</h1>
      <p>Submitted by: {{COMPANY_NAME}}</p>
    `;

    const result = prepareTemplateScaffoldForAI(template);

    expect(result).toContain('[Project Title]');
    expect(result).toContain('[Your Company Name]');
    expect(result).not.toContain('{{PROJECT_TITLE}}');
  });

  it('should preserve s3key: image tags with marker comments', () => {
    const template = `
      <img src="s3key:org-123/logo.png" alt="Logo" />
      <img data-s3-key="org-123/diagram.png" src="https://..." />
    `;

    const result = prepareTemplateScaffoldForAI(template);

    // Images are now preserved with marker comments instead of stripped
    expect(result).toContain('<!-- PRESERVE THIS IMAGE TAG EXACTLY AS-IS -->');
    expect(result).toContain('s3key:org-123/logo.png');
  });

  it('should add structured template header for templates with headings', () => {
    const template = `
      <h1>{{PROJECT_TITLE}}</h1>
      <h2>Section 1</h2>
      <p>{{CONTENT}}</p>
    `;

    const result = prepareTemplateScaffoldForAI(template);

    expect(result).toContain('<!-- TEMPLATE SCAFFOLD: You MUST follow this exact structure');
    expect(result).toContain('Keep ALL <h1>, <h2>, <h3> headings exactly as written');
  });

  it('should add simple template header for templates without headings', () => {
    const template = `
      <div class="wrapper">
        <p>{{COMPANY_NAME}} - {{PROJECT_TITLE}}</p>
        <div>{{CONTENT}}</div>
      </div>
    `;

    const result = prepareTemplateScaffoldForAI(template);

    expect(result).toContain('<!-- TEMPLATE SCAFFOLD: This template defines the document wrapper/structure');
    expect(result).not.toContain('Keep ALL <h1>, <h2>, <h3> headings');
  });

  it('should return empty string for empty input', () => {
    expect(prepareTemplateScaffoldForAI('')).toBe('');
    expect(prepareTemplateScaffoldForAI('   ')).toBe('');
  });
});

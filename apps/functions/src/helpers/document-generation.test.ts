// Mock dependencies BEFORE imports
jest.mock('./project');
jest.mock('@/handlers/organization/get-organization-by-id');
jest.mock('./opportunity');
jest.mock('./rfp-document');
jest.mock('./db');
jest.mock('./executive-opportunity-brief');
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

const mockGetProjectById = getProjectById as jest.MockedFunction<typeof getProjectById>;
const mockGetOrganizationById = getOrganizationById as jest.MockedFunction<typeof getOrganizationById>;
const mockGetOpportunity = getOpportunity as jest.MockedFunction<typeof getOpportunity>;

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
    expect(result.RESPONSE_DEADLINE).toBe('December 31, 2024');
    expect(result.SUBMISSION_DATE).toBe('December 31, 2024'); // Alias for RESPONSE_DEADLINE
    expect(result.CONTENT).toBe('');
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

    mockGetOrganizationById.mockResolvedValue(undefined);
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

  it('should strip broken s3key: image src attributes', () => {
    const template = `
      <img src="s3key:org-123/logo.png" alt="Logo" />
      <img data-s3-key="org-123/diagram.png" src="https://..." />
    `;

    const result = prepareTemplateScaffoldForAI(template);

    expect(result).toContain('<!-- [IMAGE PLACEHOLDER: Insert relevant image or diagram here] -->');
    expect(result).not.toContain('s3key:');
    expect(result).not.toContain('data-s3-key');
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

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

const mockInvokeModel = jest.fn();
jest.mock('./bedrock-http-client', () => ({
  invokeModel: (...args: unknown[]) => mockInvokeModel(...args),
}));

const mockExtractPdfStructure = jest.fn();
jest.mock('./pdf-to-html', () => ({
  extractPdfStructure: (...args: unknown[]) => mockExtractPdfStructure(...args),
  structureToJson: (blocks: unknown[]) => JSON.stringify(blocks),
}));

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn(),
}));

jest.mock('./env', () => ({
  requireEnv: (key: string, fallback?: string) => {
    if (key === 'BEDROCK_MODEL_ID') return 'test-model';
    if (key === 'DOCUMENTS_BUCKET') return 'test-bucket';
    return fallback ?? 'test-value';
  },
}));

import { generateFormHtml, refillFormHtml } from './form-html-generator';
import type { CompanyProfileItem } from '@auto-rfp/core';

const mockProfile: CompanyProfileItem = {
  orgId: 'org1',
  companyName: 'Acme Corp',
  legalEntityName: null,
  dba: null,
  address: '123 Main St',
  city: 'San Diego',
  state: 'CA',
  zip: '92117',
  phone: null,
  email: null,
  website: null,
  ein: '12-345',
  uei: null,
  cage: null,
  primaryNaics: null,
  secondaryNaics: [],
  entityType: null,
  stateEntityNumber: null,
  smallBusinessCertId: null,
  smallBusinessCertExpiration: null,
  fields: [],
  authorizedSignatory: null,
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
};

const makeLLMResponse = (html: string) =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: html }] }));

describe('generateFormHtml', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('converts PDF using Textract structure + LLM styling, then fills', async () => {
    mockExtractPdfStructure.mockResolvedValue([
      { type: 'TITLE', content: 'EXEMPTION CERTIFICATE' },
      { type: 'TEXT', content: 'The undersigned certifies...' },
    ]);

    // First call: structure→HTML, second call: fill pass
    mockInvokeModel
      .mockResolvedValueOnce(makeLLMResponse('<p style="text-align: center;"><strong>EXEMPTION CERTIFICATE</strong></p><p>The undersigned certifies...</p>'))
      .mockResolvedValueOnce(makeLLMResponse('<p style="text-align: center;"><strong>EXEMPTION CERTIFICATE</strong></p><p>The undersigned certifies... <span style="background-color: #dcfce7;">Acme Corp</span></p>'));

    const result = await generateFormHtml({
      formName: 'Exemption Certificate',
      sourceFileName: 'cert.pdf',
      sourceFileKey: 'org/cert.pdf',
      mimeType: 'application/pdf',
      documentText: 'EXEMPTION CERTIFICATE\nThe undersigned certifies...',
      fields: [],
      profile: mockProfile,
    });

    expect(result).toContain('EXEMPTION CERTIFICATE');
    expect(result).toContain('Acme Corp');
    expect(mockExtractPdfStructure).toHaveBeenCalledWith('org/cert.pdf');
    expect(mockInvokeModel).toHaveBeenCalledTimes(2);
  });

  it('falls back to text when Textract fails', async () => {
    mockExtractPdfStructure.mockRejectedValue(new Error('Textract error'));
    mockInvokeModel.mockResolvedValue(makeLLMResponse('<p>filled</p>'));

    const result = await generateFormHtml({
      formName: 'Test',
      sourceFileName: 'test.pdf',
      sourceFileKey: 'org/test.pdf',
      mimeType: 'application/pdf',
      documentText: 'Some text content',
      fields: [],
      profile: null,
    });

    expect(result).toContain('Some text content');
  });

  it('converts XLSX using sheet_to_html then fills', async () => {
    const mockBody = { transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array([80, 75, 3, 4])) };
    mockS3Send.mockResolvedValue({ Body: mockBody });

    mockInvokeModel.mockResolvedValue(makeLLMResponse('<table><tr><td>Filled</td></tr></table>'));

    const result = await generateFormHtml({
      formName: 'Matrix',
      sourceFileName: 'att.xlsx',
      sourceFileKey: 'org/att.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      documentText: 'Category\tFeature\tFully Meets',
      fields: [],
      profile: mockProfile,
    });

    expect(mockInvokeModel).toHaveBeenCalled();
    expect(typeof result).toBe('string');
  });
});

describe('refillFormHtml', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('strips existing green fills and re-fills', async () => {
    const filledResponse = '<div><p>EXEMPTION CERTIFICATE</p><p>Company: <span style="background-color: #dcfce7; padding: 2px 6px; border-radius: 3px;">New Corp</span></p></div>';
    mockInvokeModel.mockResolvedValueOnce(makeLLMResponse(filledResponse));

    const existing = '<div><p>EXEMPTION CERTIFICATE</p><p>Company: <span style="background-color: #dcfce7; padding: 2px 6px;">Old Corp</span></p></div>';
    const result = await refillFormHtml(existing, mockProfile);

    expect(result).toContain('New Corp');
    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
  });
});

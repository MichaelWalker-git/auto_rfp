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

jest.mock('./pdf-to-html', () => ({
  extractPdfStructure: jest.fn().mockResolvedValue([
    { type: 'TITLE', content: 'TEST FORM' },
    { type: 'TEXT', content: 'Some content' },
  ]),
  structureToJson: (blocks: unknown[]) => JSON.stringify(blocks),
}));

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://presigned.example.com/test.pdf'),
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
  orgId: 'org1', companyName: 'Acme Corp', legalEntityName: null, dba: null,
  address: '123 Main St', city: 'San Diego', state: 'CA', zip: '92117',
  phone: null, email: null, website: null, ein: '12-345', uei: null, cage: null,
  primaryNaics: null, secondaryNaics: [], entityType: null, stateEntityNumber: null,
  smallBusinessCertId: null, smallBusinessCertExpiration: null, fields: [],
  authorizedSignatory: null, createdAt: '2025-01-01', updatedAt: '2025-01-01',
};

const makeLLMResponse = (html: string) =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: html }] }));

describe('generateFormHtml', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock S3 to return PDF bytes for vision extraction
    mockS3Send.mockResolvedValue({
      Body: { transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])) },
    });
  });

  it('converts PDF via vision then fills', async () => {
    // Vision call (PDF→HTML) then fill call
    mockInvokeModel
      .mockResolvedValueOnce(makeLLMResponse('<p>EXEMPTION CERTIFICATE</p><p>Company: ____</p>'))
      .mockResolvedValueOnce(makeLLMResponse('<p>EXEMPTION CERTIFICATE</p><p>Company: <span style="background-color: #dcfce7;">Acme Corp</span></p>'));

    const result = await generateFormHtml({
      formName: 'Test', sourceFileName: 'cert.pdf', sourceFileKey: 'org/cert.pdf',
      mimeType: 'application/pdf', documentText: 'EXEMPTION CERTIFICATE', fields: [],
      profile: mockProfile,
    });

    expect(result).toContain('EXEMPTION CERTIFICATE');
    expect(mockInvokeModel).toHaveBeenCalled();
  });

  it('falls back when vision fails', async () => {
    mockS3Send.mockRejectedValue(new Error('S3 error'));
    mockInvokeModel.mockResolvedValue(makeLLMResponse('<p>Fallback content with more than one hundred characters to pass the length check in the generator function</p>'));

    const result = await generateFormHtml({
      formName: 'Test', sourceFileName: 'test.pdf', sourceFileKey: 'org/test.pdf',
      mimeType: 'application/pdf', documentText: 'Some text content here', fields: [],
      profile: null,
    });

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('converts XLSX with fill pass', async () => {
    mockS3Send.mockResolvedValue({
      Body: { transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array([80, 75, 3, 4])) },
    });
    mockInvokeModel.mockResolvedValue(makeLLMResponse('<table><tr><td>Filled cell content that is long enough to pass validation</td></tr></table>'));

    const result = await generateFormHtml({
      formName: 'Matrix', sourceFileName: 'att.xlsx', sourceFileKey: 'org/att.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      documentText: 'Category\tFeature', fields: [], profile: mockProfile,
    });

    expect(typeof result).toBe('string');
  });
});

describe('refillFormHtml', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('strips existing fills and re-fills', async () => {
    const filled = '<div><p>FORM</p><p>Company: <span style="background-color: #dcfce7; padding: 2px 6px; border-radius: 3px;">New Corp</span></p></div>';
    mockInvokeModel.mockResolvedValueOnce(makeLLMResponse(filled));

    const existing = '<div><p>FORM</p><p>Company: <span style="background-color: #dcfce7; padding: 2px 6px;">Old Corp</span></p></div>';
    const result = await refillFormHtml(existing, mockProfile);

    expect(result).toContain('New Corp');
    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
  });
});

/**
 * Focused orgId-propagation test for the extraction processor: the caller's
 * orgId (from the extraction input) must reach the Bedrock extraction call
 * (per-org Bedrock key).
 */
const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...a: unknown[]) => mockInvokeModel(...a),
}));

const mockLoadTextFromS3 = jest.fn();
jest.mock('@/helpers/s3', () => ({
  getFileFromS3: jest.fn(),
  loadTextFromS3: (...a: unknown[]) => mockLoadTextFromS3(...a),
}));

jest.mock('@/helpers/extraction', () => ({
  createDraftPastProjectRecord: jest.fn(),
  checkDuplicatePastProject: jest.fn(),
  listDraftRecords: jest.fn().mockResolvedValue([]),
  createDraftLaborRateRecord: jest.fn(),
  checkDuplicateLaborRate: jest.fn(),
  createDraftBOMItemRecord: jest.fn(),
}));

const mockListPastProjects = jest.fn();
jest.mock('@/helpers/past-performance', () => ({
  listPastProjects: (...a: unknown[]) => mockListPastProjects(...a),
}));

jest.mock('@/helpers/pricing', () => ({
  getLaborRatesByOrg: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/helpers/env', () => ({
  requireEnv: (_name: string, fallback?: string) => fallback ?? 'test-value',
}));

import { extractPastPerformanceFromDocument } from './extraction-processor';

/** Bedrock response wrapping the model's text content. */
const bedrockResponse = (text: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }] }));

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadTextFromS3.mockResolvedValue('Some resume / past-performance document text.');
  mockListPastProjects.mockResolvedValue({ items: [] });
  // Empty extraction array → no drafts created, keeps the test focused on the call.
  mockInvokeModel.mockResolvedValue(bedrockResponse('[]'));
});

describe('extractPastPerformanceFromDocument — orgId propagation', () => {
  it('threads the input orgId through to invokeModel as the third argument', async () => {
    await extractPastPerformanceFromDocument({
      orgId: 'the-org-id',
      jobId: 'job-1',
      s3Key: 'uploads/resume.txt',
      fileName: 'resume.txt',
      userId: 'user-1',
    });

    expect(mockInvokeModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'the-org-id',
    );
  });
});

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-textract', () => ({
  TextractClient: jest.fn(() => ({ send: mockSend })),
  StartDocumentAnalysisCommand: jest.fn((params) => ({ type: 'Start', params })),
  GetDocumentAnalysisCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

process.env.REGION = 'us-east-1';

import type { Block } from '@aws-sdk/client-textract';
import {
  startFormsAnalysis,
  fetchAllAnalysisBlocks,
  mapBlocksToFields,
} from './textract-forms';

const bbox = (left: number, top: number) => ({
  BoundingBox: { Left: left, Top: top, Width: 0.2, Height: 0.02 },
  Polygon: [],
});

const wordBlock = (id: string, text: string): Block => ({
  Id: id,
  BlockType: 'WORD',
  Text: text,
  Geometry: bbox(0, 0),
});

const selectionBlock = (id: string, status: 'SELECTED' | 'NOT_SELECTED'): Block => ({
  Id: id,
  BlockType: 'SELECTION_ELEMENT',
  SelectionStatus: status,
  Geometry: bbox(0, 0),
});

const kvBlock = (
  id: string,
  entity: 'KEY' | 'VALUE',
  childIds: string[],
  valueId: string | undefined,
  page = 1,
  pos: { left: number; top: number } = { left: 0.1, top: 0.1 },
): Block => ({
  Id: id,
  BlockType: 'KEY_VALUE_SET',
  EntityTypes: [entity],
  Page: page,
  Geometry: bbox(pos.left, pos.top),
  Relationships: [
    ...(childIds.length ? [{ Type: 'CHILD' as const, Ids: childIds }] : []),
    ...(valueId ? [{ Type: 'VALUE' as const, Ids: [valueId] }] : []),
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
});

describe('startFormsAnalysis', () => {
  it('starts a Textract job with FORMS + SIGNATURES feature types and returns the JobId', async () => {
    mockSend.mockResolvedValueOnce({ JobId: 'job-123' });

    const jobId = await startFormsAnalysis({
      bucket: 'docs-bucket',
      fileKey: 'org/proj/form.pdf',
      jobTag: 'form-456',
      snsTopicArn: 'arn:sns:topic',
      roleArn: 'arn:role',
    });

    expect(jobId).toBe('job-123');
    const call = mockSend.mock.calls[0][0];
    expect(call.params).toMatchObject({
      DocumentLocation: { S3Object: { Bucket: 'docs-bucket', Name: 'org/proj/form.pdf' } },
      FeatureTypes: ['FORMS', 'SIGNATURES'],
      JobTag: 'form-456',
      NotificationChannel: { SNSTopicArn: 'arn:sns:topic', RoleArn: 'arn:role' },
    });
  });

  it('throws when Textract returns no JobId', async () => {
    mockSend.mockResolvedValueOnce({});
    await expect(
      startFormsAnalysis({
        bucket: 'b', fileKey: 'k', jobTag: 't', snsTopicArn: 'sns', roleArn: 'role',
      }),
    ).rejects.toThrow('Textract did not return JobId');
  });
});

describe('fetchAllAnalysisBlocks', () => {
  it('paginates through NextToken pages and concatenates blocks', async () => {
    mockSend
      .mockResolvedValueOnce({ JobStatus: 'SUCCEEDED', Blocks: [{ Id: 'a' }], NextToken: 't1' })
      .mockResolvedValueOnce({ JobStatus: 'SUCCEEDED', Blocks: [{ Id: 'b' }], NextToken: 't2' })
      .mockResolvedValueOnce({ JobStatus: 'SUCCEEDED', Blocks: [{ Id: 'c' }] });

    const blocks = await fetchAllAnalysisBlocks('job-1');
    expect(blocks.map((b) => b.Id)).toEqual(['a', 'b', 'c']);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('throws when JobStatus is FAILED', async () => {
    mockSend.mockResolvedValueOnce({ JobStatus: 'FAILED' });
    await expect(fetchAllAnalysisBlocks('job-1')).rejects.toThrow(/job-1/);
  });

  it('accepts PARTIAL_SUCCESS', async () => {
    mockSend.mockResolvedValueOnce({ JobStatus: 'PARTIAL_SUCCESS', Blocks: [{ Id: 'x' }] });
    const blocks = await fetchAllAnalysisBlocks('job-1');
    expect(blocks).toHaveLength(1);
  });
});

describe('mapBlocksToFields', () => {
  it('skips a KEY/VALUE pair whose VALUE already has text — only blanks reach the editor', () => {
    const blocks: Block[] = [
      wordBlock('w-key1', 'Company'),
      wordBlock('w-key2', 'Name'),
      wordBlock('w-val1', 'Acme'),
      wordBlock('w-val2', 'Corp'),
      kvBlock('val-1', 'VALUE', ['w-val1', 'w-val2'], undefined, 1, { left: 0.5, top: 0.1 }),
      kvBlock('key-1', 'KEY', ['w-key1', 'w-key2'], 'val-1', 1, { left: 0.1, top: 0.1 }),
    ];
    const fields = mapBlocksToFields(blocks);
    expect(fields).toEqual([]);
  });

  it('maps an empty VALUE block to an EMPTY field', () => {
    const blocks: Block[] = [
      wordBlock('w-key1', 'Address'),
      kvBlock('val-1', 'VALUE', [], undefined),
      kvBlock('key-1', 'KEY', ['w-key1'], 'val-1'),
    ];
    const fields = mapBlocksToFields(blocks);
    expect(fields[0]).toMatchObject({ label: 'Address', value: null, status: 'EMPTY' });
  });

  it('keeps signature/notary labels as MANUAL_REQUIRED even when a name is already written', () => {
    const blocks: Block[] = [
      wordBlock('w-key1', 'Signature'),
      wordBlock('w-val1', 'Nates'),
      wordBlock('w-val2', 'Ben'),
      kvBlock('val-1', 'VALUE', ['w-val1', 'w-val2'], undefined),
      kvBlock('key-1', 'KEY', ['w-key1'], 'val-1'),
    ];
    const fields = mapBlocksToFields(blocks);
    expect(fields[0]).toMatchObject({
      label: 'Signature',
      status: 'MANUAL_REQUIRED',
      manualReason: expect.stringMatching(/signature/i),
    });
  });

  it('treats a SELECTION_ELEMENT VALUE as a checkbox MANUAL_REQUIRED', () => {
    const blocks: Block[] = [
      wordBlock('w-key1', 'A'),
      wordBlock('w-key2', 'house'),
      selectionBlock('sel-1', 'NOT_SELECTED'),
      kvBlock('val-1', 'VALUE', ['sel-1'], undefined),
      kvBlock('key-1', 'KEY', ['w-key1', 'w-key2'], 'val-1'),
    ];
    const fields = mapBlocksToFields(blocks);
    expect(fields[0]).toMatchObject({
      label: 'A house',
      value: 'No',
      status: 'MANUAL_REQUIRED',
      manualReason: expect.stringMatching(/checkbox/i),
    });
  });

  it('emits a standalone MANUAL_REQUIRED field for each SIGNATURE block', () => {
    const blocks: Block[] = [
      { Id: 'sig-1', BlockType: 'SIGNATURE', Page: 2, Geometry: bbox(0.6, 0.85) },
    ];
    const fields = mapBlocksToFields(blocks);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      label: 'Signature',
      status: 'MANUAL_REQUIRED',
      pageNumber: 2,
    });
    expect(fields[0].boundingBox?.left).toBeCloseTo(0.6);
  });

  it('preserves per-page numbering across multipage documents', () => {
    const blocks: Block[] = [
      wordBlock('w1', 'City'),
      kvBlock('val-p1', 'VALUE', [], undefined, 1),
      kvBlock('key-p1', 'KEY', ['w1'], 'val-p1', 1),
      wordBlock('w2', 'Zip'),
      kvBlock('val-p3', 'VALUE', [], undefined, 3),
      kvBlock('key-p3', 'KEY', ['w2'], 'val-p3', 3),
    ];
    const fields = mapBlocksToFields(blocks);
    expect(fields.map((f) => f.pageNumber).sort()).toEqual([1, 3]);
  });

  it('returns an empty array when no KEY_VALUE_SET or SIGNATURE blocks exist', () => {
    const blocks: Block[] = [wordBlock('w', 'plain text')];
    expect(mapBlocksToFields(blocks)).toEqual([]);
  });
});

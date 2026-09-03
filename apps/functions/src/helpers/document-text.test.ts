jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: jest.fn(),
  tryLoadTextFromS3: jest.fn(),
}));

import { buildTextKeyCandidates, loadDocumentText } from './document-text';
import * as s3 from '@/helpers/s3';

const mockLoadTextFromS3 = s3.loadTextFromS3 as jest.MockedFunction<typeof s3.loadTextFromS3>;
const mockTryLoadTextFromS3 = s3.tryLoadTextFromS3 as jest.MockedFunction<
  typeof s3.tryLoadTextFromS3
>;

const BUCKET = 'documents-bucket';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildTextKeyCandidates', () => {
  it('returns the recorded key first, then the fileKey-derived key', () => {
    expect(
      buildTextKeyCandidates({
        textFileKey: 'org/kb/doc/CV.docx.txt',
        fileKey: 'org/kb/doc/CV.docx',
      }),
    ).toEqual(['org/kb/doc/CV.docx.txt', 'org/kb/doc/CV.txt']);
  });

  it('deduplicates when the recorded key already matches the derived key', () => {
    expect(
      buildTextKeyCandidates({ textFileKey: 'org/kb/doc/CV.txt', fileKey: 'org/kb/doc/CV.docx' }),
    ).toEqual(['org/kb/doc/CV.txt']);
  });

  it('falls back to the fileKey-derived key when no text key was recorded', () => {
    expect(buildTextKeyCandidates({ fileKey: 'org/kb/doc/CV.docx' })).toEqual([
      'org/kb/doc/CV.txt',
    ]);
  });

  it('returns nothing when the document has neither key', () => {
    expect(buildTextKeyCandidates({})).toEqual([]);
  });
});

describe('loadDocumentText', () => {
  it('returns the text at the recorded key without probing further', async () => {
    mockTryLoadTextFromS3.mockResolvedValue('CV text');

    const text = await loadDocumentText(BUCKET, {
      textFileKey: 'org/kb/doc/CV.docx.txt',
      fileKey: 'org/kb/doc/CV.docx',
    });

    expect(text).toBe('CV text');
    expect(mockTryLoadTextFromS3).toHaveBeenCalledTimes(1);
    expect(mockLoadTextFromS3).not.toHaveBeenCalled();
  });

  it('falls back to the fileKey-derived key when the recorded key is missing', async () => {
    mockTryLoadTextFromS3.mockImplementation(async (_bucket, key) =>
      key === 'org/kb/doc/CV.txt' ? 'CV text' : null,
    );

    const text = await loadDocumentText(BUCKET, {
      textFileKey: 'org/kb/doc/CV.docx.txt',
      fileKey: 'org/kb/doc/CV.docx',
    });

    expect(text).toBe('CV text');
    expect(mockLoadTextFromS3).not.toHaveBeenCalled();
  });

  it('retries the recorded key when every candidate comes back empty', async () => {
    mockTryLoadTextFromS3.mockResolvedValue(null);
    mockLoadTextFromS3.mockResolvedValue('CV text');

    const text = await loadDocumentText(BUCKET, {
      textFileKey: 'org/kb/doc/CV.docx.txt',
      fileKey: 'org/kb/doc/CV.docx',
    });

    expect(text).toBe('CV text');
    expect(mockLoadTextFromS3).toHaveBeenCalledWith(BUCKET, 'org/kb/doc/CV.docx.txt');
  });

  it('propagates the S3 error when the text genuinely cannot be read', async () => {
    mockTryLoadTextFromS3.mockResolvedValue(null);
    mockLoadTextFromS3.mockRejectedValue(new Error('The specified key does not exist.'));

    await expect(
      loadDocumentText(BUCKET, { textFileKey: 'org/kb/doc/CV.docx.txt' }),
    ).rejects.toThrow('The specified key does not exist.');
  });

  it('returns an empty string when the document has no key to read', async () => {
    expect(await loadDocumentText(BUCKET, {})).toBe('');
    expect(mockTryLoadTextFromS3).not.toHaveBeenCalled();
    expect(mockLoadTextFromS3).not.toHaveBeenCalled();
  });
});

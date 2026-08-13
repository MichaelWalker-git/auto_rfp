import { act, renderHook, waitFor } from '@testing-library/react';
import { useEditorImageUpload } from '../useEditorImageUpload';

const mockPresignUpload = jest.fn();
const mockPresignDownload = jest.fn();
const mockUploadFileToS3 = jest.fn();

jest.mock('@/lib/hooks/use-presign', () => ({
  usePresignUpload: () => ({ trigger: mockPresignUpload }),
  usePresignDownload: () => ({ trigger: mockPresignDownload }),
  uploadFileToS3: (...args: unknown[]) => mockUploadFileToS3(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useEditorImageUpload', () => {
  it('uploads an image via a presigned URL under the org editor-images prefix', async () => {
    mockPresignUpload.mockResolvedValue({
      url: 'https://s3.presigned/upload',
      method: 'PUT',
      key: 'org-1/editor-images/diagram.png',
    });
    mockUploadFileToS3.mockResolvedValue(undefined);
    const file = new File(['img'], 'diagram.png', { type: 'image/png' });

    const { result } = renderHook(() => useEditorImageUpload('org-1'));
    const key = await result.current.handleUploadImageToS3(file);

    expect(mockPresignUpload).toHaveBeenCalledWith({
      fileName: 'diagram.png',
      contentType: 'image/png',
      prefix: 'org-1/editor-images',
    });
    expect(mockUploadFileToS3).toHaveBeenCalledWith('https://s3.presigned/upload', 'PUT', file);
    expect(key).toBe('org-1/editor-images/diagram.png');
  });

  it('resolves an s3 key to a presigned download URL', async () => {
    mockPresignDownload.mockResolvedValue({ url: 'https://s3.presigned/download' });

    const { result } = renderHook(() => useEditorImageUpload('org-1'));
    const url = await result.current.handleGetDownloadUrl('org-1/editor-images/diagram.png');

    expect(mockPresignDownload).toHaveBeenCalledWith({ key: 'org-1/editor-images/diagram.png' });
    expect(url).toBe('https://s3.presigned/download');
  });

  it('tracks the in-flight upload state the editor uses to gate saving', async () => {
    const { result } = renderHook(() => useEditorImageUpload('org-1'));
    expect(result.current.isImageUploading).toBe(false);

    act(() => result.current.setIsImageUploading(true));
    await waitFor(() => expect(result.current.isImageUploading).toBe(true));

    act(() => result.current.setIsImageUploading(false));
    await waitFor(() => expect(result.current.isImageUploading).toBe(false));
  });
});

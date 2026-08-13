'use client';

import { useCallback, useState } from 'react';
import { uploadFileToS3, usePresignDownload, usePresignUpload } from '@/lib/hooks/use-presign';

/**
 * Image handling for the Solution Plan rich-text editor, mirroring the
 * opportunity document editor: pasted/inserted images upload to S3 via
 * presigned URLs and render back through short-lived download URLs
 * (`s3key:` references in the stored HTML).
 */
export const useEditorImageUpload = (orgId: string) => {
  const [isImageUploading, setIsImageUploading] = useState(false);
  const { trigger: triggerPresignUpload } = usePresignUpload();
  const { trigger: triggerPresignDownload } = usePresignDownload();

  const handleUploadImageToS3 = useCallback(
    async (file: File): Promise<string> => {
      const presign = await triggerPresignUpload({
        fileName: file.name,
        contentType: file.type,
        prefix: `${orgId}/editor-images`,
      });
      await uploadFileToS3(presign.url, presign.method, file);
      return presign.key;
    },
    [orgId, triggerPresignUpload],
  );

  const handleGetDownloadUrl = useCallback(
    async (key: string): Promise<string> => {
      const presign = await triggerPresignDownload({ key });
      return presign.url;
    },
    [triggerPresignDownload],
  );

  return { isImageUploading, setIsImageUploading, handleUploadImageToS3, handleGetDownloadUrl };
};

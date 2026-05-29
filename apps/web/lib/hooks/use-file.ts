'use client';

import { useState } from 'react';
import { usePresignDownload } from './use-presign';

type DownloadOptions = {
  key: string;          // S3 key
  fileName?: string;    // optional user-friendly filename
};

export function useDownloadFromS3() {
  const { trigger: presignDownload, error: presignError } = usePresignDownload();
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const downloadFile = async ({ key, fileName }: DownloadOptions) => {
    setIsDownloading(true);
    setError(null);

    try {
      // 1) Get presigned URL for this key
      const presign = await presignDownload({ key });

      // 2) Fetch the file via presigned URL
      const res = await fetch(presign.url, {
        method: presign.method || 'GET',
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || 'Failed to download file from S3');
      }

      const blob = await res.blob();

      // 3) Trigger browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');

      const fallbackName =
        fileName ||
        key.split('/').pop() ||
        'download';

      a.href = url;
      a.download = fallbackName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      setError(err instanceof Error ? err : new Error('Unknown download error'));
      throw err;
    } finally {
      setIsDownloading(false);
    }
  };

  return {
    downloadFile,
    isDownloading,
    error: error || (presignError as Error | null) || null,
  };
}

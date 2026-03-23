'use client';

import { useCallback, useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { usePresignUpload, uploadFileToS3 } from '@/lib/hooks/use-presign';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp'];
const MAX_ICON_SIZE = 2 * 1024 * 1024; // 2MB

interface UseOrganizationIconResult {
  iconUrl: string;
  iconS3Key: string;
  isUploadingIcon: boolean;
  isLoadingIcon: boolean;
  handleIconUpload: (file: File) => Promise<void>;
  handleRemoveIcon: () => void;
  loadIconPresignedUrl: (key: string) => Promise<void>;
  setIconUrl: (url: string) => void;
  setIconS3Key: (key: string) => void;
}

export const useOrganizationIcon = (orgId: string): UseOrganizationIconResult => {
  const [iconUrl, setIconUrl] = useState('');
  const [iconS3Key, setIconS3Key] = useState('');
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [isLoadingIcon, setIsLoadingIcon] = useState(false);
  const { toast } = useToast();
  const { trigger: presignUpload } = usePresignUpload();

  const loadIconPresignedUrl = useCallback(async (key: string) => {
    try {
      setIsLoadingIcon(true);
      const res = await authFetcher(`${env.BASE_API_URL}/presigned/presigned-url`, {
        method: 'POST',
        body: JSON.stringify({ operation: 'download', key }),
      });
      if (res.ok) {
        const data = await res.json();
        setIconUrl(data.url);
      }
    } catch {
      // Silently fail — icon just won't show
    } finally {
      setIsLoadingIcon(false);
    }
  }, []);

  const handleIconUpload = useCallback(async (file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a PNG, JPEG, GIF, SVG, or WebP image.',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > MAX_ICON_SIZE) {
      toast({
        title: 'File too large',
        description: 'Icon image must be less than 2MB.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsUploadingIcon(true);

      // Get presigned URL for upload
      const presign = await presignUpload({
        fileName: file.name,
        contentType: file.type,
        prefix: `organizations/${orgId}/icon`,
      });

      // Upload file to S3
      await uploadFileToS3(presign.url, presign.method, file);

      // Store the S3 key for saving to the org record (normalize double slashes)
      const normalizedKey = (presign.key as string).replace(/\/\//g, '/');
      setIconS3Key(normalizedKey);

      // Get a presigned download URL for immediate display
      try {
        const iconRes = await authFetcher(`${env.BASE_API_URL}/presigned/presigned-url`, {
          method: 'POST',
          body: JSON.stringify({ operation: 'download', key: presign.key }),
        });
        if (iconRes.ok) {
          const iconData = await iconRes.json();
          setIconUrl(iconData.url);
        } else {
          setIconUrl('');
        }
      } catch {
        setIconUrl('');
      }

      toast({
        title: 'Icon uploaded',
        description: 'Click "Save Changes" to apply the new icon.',
      });
    } catch (error) {
      console.error('Error uploading icon:', error);
      toast({
        title: 'Upload failed',
        description: 'Failed to upload icon image. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUploadingIcon(false);
    }
  }, [orgId, presignUpload, toast]);

  const handleRemoveIcon = useCallback(() => {
    setIconUrl('');
    setIconS3Key('');
    toast({
      title: 'Icon removed',
      description: 'Click "Save Changes" to apply the change.',
    });
  }, [toast]);

  return {
    iconUrl,
    iconS3Key,
    isUploadingIcon,
    isLoadingIcon,
    handleIconUpload,
    handleRemoveIcon,
    loadIconPresignedUrl,
    setIconUrl,
    setIconS3Key,
  };
};

'use client';

import { useState, useRef } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { PermissionButton } from '@/components/ui/permission-button';
import { useToast } from '@/components/ui/use-toast';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FoiaResponseUploadProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  foiaRequestId: string;
  onUploadComplete?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Allows uploading agency response documents for a FOIA request.
 *
 * Flow:
 * 1. Get presigned upload URL from POST /presigned/presigned-url
 * 2. Upload file to S3 via PUT to presigned URL
 * 3. Add document metadata via POST /foia/add-foia-response-document
 */
export const FoiaResponseUpload = ({
  orgId,
  projectId,
  opportunityId,
  foiaRequestId,
  onUploadComplete,
}: FoiaResponseUploadProps) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const baseUrl = env.BASE_API_URL.replace(/\/$/, '');

      // Step 1: Get presigned upload URL
      const presignedRes = await authFetcher(`${baseUrl}/presigned/presigned-url`, {
        method: 'POST',
        body: JSON.stringify({
          operation: 'upload',
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          prefix: `foia-responses/${orgId}/${projectId}/${opportunityId}/`,
        }),
      });

      if (!presignedRes.ok) {
        const body = await presignedRes.text().catch(() => '');
        throw new Error(`Failed to get upload URL: ${presignedRes.status}. ${body}`);
      }

      const presignedData = await presignedRes.json();
      const { url, key } = presignedData;

      // Step 2: Upload file to S3
      const uploadRes = await fetch(url, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
      });

      if (!uploadRes.ok) {
        throw new Error(`Failed to upload file to S3: ${uploadRes.status}`);
      }

      // Step 3: Add document metadata to FOIA request
      const addDocRes = await authFetcher(`${baseUrl}/foia/add-foia-response-document`, {
        method: 'POST',
        body: JSON.stringify({
          orgId,
          projectId,
          oppId: opportunityId,
          foiaRequestId,
          document: {
            s3Key: key,
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          },
        }),
      });

      if (!addDocRes.ok) {
        const body = await addDocRes.text().catch(() => '');
        throw new Error(`Failed to add document metadata: ${addDocRes.status}. ${body}`);
      }

      toast({
        title: 'Upload successful',
        description: `${file.name} has been uploaded.`,
      });

      onUploadComplete?.();

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Failed to upload file',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileSelect}
        className="hidden"
        accept=".pdf,.doc,.docx,.txt,.zip"
        aria-label="Select file to upload"
      />
      <PermissionButton
        requiredPermission="project:edit"
        variant="outline"
        size="sm"
        onClick={handleButtonClick}
        disabled={isUploading}
      >
        {isUploading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <Upload className="h-3.5 w-3.5 mr-1" />
            Upload agency response
          </>
        )}
      </PermissionButton>
    </div>
  );
};

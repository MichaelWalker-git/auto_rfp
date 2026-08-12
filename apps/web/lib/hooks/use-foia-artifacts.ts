'use client';

import { useState } from 'react';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type { FoiaArtifact, FOIAResponseDocument } from '@auto-rfp/core';

// ─── Presigned URL Types ──────────────────────────────────────────────────────

interface PresignedUrlRequest {
  operation: 'upload' | 'download';
  key?: string;
  fileName?: string;
  contentType?: string;
  prefix?: string;
}

interface PresignedUrlResponse {
  operation: 'upload' | 'download';
  bucket: string;
  key: string;
  url: string;
  method: 'PUT' | 'GET';
  expiresIn: number;
  file?: {
    fileId: string;
    sortKey: string;
  };
}

// ─── Download URLs Hook ───────────────────────────────────────────────────────

interface UseFoiaArtifactsResult {
  getDownloadUrl: (artifact: FoiaArtifact | FOIAResponseDocument) => Promise<string>;
  isLoading: boolean;
}

export const useFoiaArtifacts = (): UseFoiaArtifactsResult => {
  const [isLoading, setIsLoading] = useState(false);

  const getDownloadUrl = async (artifact: FoiaArtifact | FOIAResponseDocument): Promise<string> => {
    setIsLoading(true);
    try {
      const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
      const url = `${baseUrl}/presigned/presigned-url`;

      const payload: PresignedUrlRequest = {
        operation: 'download',
        key: artifact.s3Key,
      };

      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to get download URL: ${res.status}. ${body}`);
      }

      const result: PresignedUrlResponse = await res.json();
      return result.url;
    } finally {
      setIsLoading(false);
    }
  };

  return { getDownloadUrl, isLoading };
};

// ─── Send FOIA Request Hook ───────────────────────────────────────────────────

interface SendFoiaRequestPayload {
  orgId: string;
  projectId: string;
  oppId: string;
  dryRun?: boolean;
}

interface SendFoiaRequestResponse {
  ok: boolean;
  dryRun?: boolean;
  sentAt?: string;
  messageId?: string;
  recipient: string;
  attached: string[];
  subject?: string;
  letter?: string;
}

interface UseSendFoiaRequestResult {
  sendFoiaRequest: (payload: SendFoiaRequestPayload) => Promise<SendFoiaRequestResponse>;
  isSending: boolean;
}

export const useSendFoiaRequest = (): UseSendFoiaRequestResult => {
  const [isSending, setIsSending] = useState(false);

  const sendFoiaRequest = async (
    payload: SendFoiaRequestPayload
  ): Promise<SendFoiaRequestResponse> => {
    setIsSending(true);
    try {
      const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
      const url = `${baseUrl}/foia/send-foia-request`;

      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');

        // Handle specific error cases
        if (res.status === 409) {
          throw new Error('This request has already been sent or is currently being sent.');
        }

        if (res.status === 502) {
          throw new Error(`Failed to send FOIA request. ${body}`);
        }

        throw new Error(`Failed to send FOIA request: ${res.status}. ${body}`);
      }

      const result = await res.json();
      return result as SendFoiaRequestResponse;
    } finally {
      setIsSending(false);
    }
  };

  return { sendFoiaRequest, isSending };
};

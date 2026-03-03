"use client";

import useSWRMutation from "swr/mutation";
import { fetchAuthSession } from "aws-amplify/auth";
import { env } from "@/lib/env";

/**
 * Adjust this to match your backend route
 * e.g. API Gateway:  `${env.BASE_API_URL}/file/presign`
 */
const PRESIGN_URL = `${env.BASE_API_URL}/presigned/generate-presigned-url`;

export type PresignUploadResponse = {
  operation: "upload";
  bucket: string;
  key: string;
  url: string;
  method: "PUT" | string;
  expiresIn: number;
  file: {
    fileId: string;
    sortKey: string;
  };
};

export type PresignDownloadResponse = {
  operation: "download";
  bucket: string;
  key: string;
  url: string;
  method: "GET" | string;
  expiresIn: number;
};

export type PresignUploadRequest = {
  fileName: string;
  contentType: string;
  prefix?: string;
  key?: string;
};

export type PresignDownloadRequest = {
  key: string;
};

type PresignBaseRequest = {
  operation: "upload" | "download";
};

type PresignRequest = (PresignUploadRequest | PresignDownloadRequest) &
  PresignBaseRequest;

async function authedJsonPost<TResponse, TBody>(
  url: string,
  body: TBody,
): Promise<TResponse> {
  let token: string | undefined;

  if (typeof window !== "undefined") {
    const session = await fetchAuthSession();
    token = session.tokens?.idToken?.toString(); // or accessToken
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const error: any = new Error(
      errorData.message || errorData.error || "Presign request failed",
    );
    error.status = res.status;
    throw error;
  }

  return res.json();
}

/**
 * SWR mutation fetcher for both upload & download presign
 */
async function presignFetcher(
  url: string,
  { arg }: { arg: PresignRequest },
): Promise<PresignUploadResponse | PresignDownloadResponse> {
  return authedJsonPost(url, arg);
}

/**
 * Hook for getting presigned URL for *upload*.
 *
 * Usage:
 *   const { trigger, data, error, isMutating } = usePresignUpload();
 *   const presign = await trigger({ fileName, contentType, prefix: "documents" });
 */
export function usePresignUpload() {
  return useSWRMutation<
    PresignUploadResponse,
    any,
    string,
    PresignUploadRequest
  >(PRESIGN_URL, (url, { arg }) =>
    presignFetcher(url, {
      arg: {
        ...arg,
        operation: "upload",
      },
    }) as Promise<PresignUploadResponse>,
  );
}

/**
 * Hook for getting presigned URL for *download*.
 *
 * Usage:
 *   const { trigger, data, error, isMutating } = usePresignDownload();
 *   const presign = await trigger({ key: "documents/..." });
 */
export function usePresignDownload() {
  return useSWRMutation<
    PresignDownloadResponse,
    any,
    string,
    PresignDownloadRequest
  >(PRESIGN_URL, (url, { arg }) =>
    presignFetcher(url, {
      arg: {
        ...arg,
        operation: "download",
      },
    }) as Promise<PresignDownloadResponse>,
  );
}

/**
 * Helper for actually uploading file to S3 with the presigned URL.
 * This is not a hook, just a simple util that you can import.
 */
export async function uploadFileToS3(
  url: string,
  method: string,
  file: File,
): Promise<void> {
  const res = await fetch(url, {
    method: method || "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error = new Error(
      text || "Failed to upload file to S3 via presigned URL",
    );
    throw error;
  }
}

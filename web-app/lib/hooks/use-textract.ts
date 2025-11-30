"use client";

import { fetchAuthSession } from "aws-amplify/auth";
import { env } from "@/lib/env";

export interface StartTextractPayload {
  s3Key: string;
  s3Bucket?: string;
}

export interface StartTextractResponse {
  jobId: string;
  s3Key: string;
  s3Bucket: string;
}

/**
 * Hook to start Textract text extraction.
 * Usage:
 *   const { startExtraction } = useStartTextractExtraction();
 *   const res = await startExtraction({ s3Key, s3Bucket });
 */
export function useStartTextractExtraction() {
  const startExtraction = async (
    payload: StartTextractPayload,
  ): Promise<StartTextractResponse> => {
    let token: string | undefined;

    if (typeof window !== "undefined") {
      const session = await fetchAuthSession();
      token = session.tokens?.idToken?.toString();
    }

    const res = await fetch(
      `${env.BASE_API_URL}/textract/begin-extraction`,
      {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const error = new Error(
        text || "Failed to start Textract extraction",
      );
      throw error;
    }

    return res.json();
  };

  return { startExtraction };
}


export interface CheckTextractPayload {
  jobId: string;
  s3Key: string;
  s3Bucket?: string;
}

export interface CheckTextractResponse {
  status: "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | string;
  jobId: string;
  bucket?: string;
  txtKey?: string;
  message?: string;
  textLength?: number;
}

/**
 * Hook to check Textract job status and get txtKey when ready.
 * Usage:
 *   const { checkTextract } = useTextractResult();
 *   const result = await checkTextract({ jobId, s3Key, s3Bucket });
 */
export function useTextractResult() {
  const checkTextract = async (
    payload: CheckTextractPayload,
  ): Promise<CheckTextractResponse> => {
    let token: string | undefined;

    if (typeof window !== "undefined") {
      const session = await fetchAuthSession();
      token = session.tokens?.idToken?.toString();
    }

    const res = await fetch(
      `${env.BASE_API_URL}/textract/get-result`,
      {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      let details: any = null;
      try {
        details = await res.json();
      } catch {
        // ignore
      }
      const error: any = new Error(
        details?.message || "Failed to check Textract status",
      );
      error.status = res.status;
      error.details = details;
      throw error;
    }

    return res.json();
  };

  return { checkTextract };
}


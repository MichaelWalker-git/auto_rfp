"use client";

import useSWRMutation from "swr/mutation";
import { env } from "@/lib/env";
import { authFetcher } from "@/lib/auth/auth-fetcher";
import type {
  LoadSamOpportunitiesRequest,
  LoadSamOpportunitiesResponse,
} from "@auto-rfp/shared";

/**
 * POST /samgov/opportunities
 * Calls your API Gateway lambda (SAM.gov search) and returns the response.
 */
export function useSearchOpportunities() {
  return useSWRMutation<
    LoadSamOpportunitiesResponse,
    any,
    string,
    LoadSamOpportunitiesRequest
  >(
    `${env.BASE_API_URL}/samgov/opportunities`,
    async (url, { arg }) => {
      const res = await authFetcher(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(arg),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => "");
        const error = new Error(message || "Failed to search SAM.gov opportunities") as Error & {
          status?: number;
        };
        (error as any).status = res.status;
        throw error;
      }

      const raw = await res.text().catch(() => "");
      if (!raw) {
        // Shouldn't happen for this endpoint, but keep it defensive
        return {
          totalRecords: 0,
          limit: arg.limit ?? 25,
          offset: arg.offset ?? 0,
          opportunities: [],
        };
      }

      try {
        return JSON.parse(raw) as LoadSamOpportunitiesResponse;
      } catch {
        throw new Error("Invalid JSON response from SAM.gov opportunities endpoint");
      }
    }
  );
}
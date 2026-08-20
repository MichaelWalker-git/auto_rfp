'use client';

import { useCallback } from 'react';
import { z } from 'zod';

import {
  ApiError,
  useGenerateRFPDocument,
  useRFPDocuments,
  type GenerateRFPDocumentResponse,
} from '@/lib/hooks/use-rfp-documents';
import type { RFPDocumentItem } from '@auto-rfp/core';

/** Default guidance when the 409 body carries no message (FR4.2). */
export const TEAM_REQUIRED_MESSAGE =
  'Review and save the team in the Team Definition section before generating Team Qualifications.';

/**
 * 409 body produced by the saved-team guard on POST
 * /rfp-document/generate-document (team-definition U4, BR1.1).
 */
const TeamRequiredBodySchema = z.object({
  code: z.literal('TEAM_REQUIRED'),
  message: z.string().optional(),
});

/**
 * Extract the saved-team guidance from a generate-document failure. Returns
 * null for anything that is not the guard's 409 TEAM_REQUIRED response.
 * Exported for tests.
 */
export const toTeamRequiredMessage = (err: unknown): string | null => {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(err.message);
  } catch {
    return null; // Not a JSON body
  }
  const { success, data } = TeamRequiredBodySchema.safeParse(raw);
  if (!success) return null;
  return data.message || TEAM_REQUIRED_MESSAGE;
};

/**
 * Generate the TEAM_QUALIFICATIONS document for an opportunity from the
 * solution plan's Team Definition section (U4, FR4.2/FR4.3).
 *
 * Posts to the EXISTING generate-document endpoint — the document lands among
 * the plan's documents via the existing pipeline (BR3.1). The opportunity's
 * documents list is revalidated after the 202, and its built-in polling keeps
 * refreshing while the run is GENERATING.
 */
export const useGenerateTeamQualifications = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
) => {
  const { trigger, isMutating } = useGenerateRFPDocument(orgId);
  const {
    documents,
    isLoading: isDocumentsLoading,
    mutate: refreshDocuments,
  } = useRFPDocuments(projectId ?? null, orgId ?? null, opportunityId ?? null);

  // Newest TEAM_QUALIFICATIONS document for this opportunity (the list is
  // sorted newest-first) — drives the View action and the in-flight state.
  const teamQualificationsDocument: RFPDocumentItem | null =
    documents.find((doc) => doc.documentType === 'TEAM_QUALIFICATIONS') ?? null;

  const isDocumentGenerating =
    teamQualificationsDocument?.status === 'GENERATING' ||
    teamQualificationsDocument?.status === 'RETRYING';

  const generateTeamQualifications =
    useCallback(async (): Promise<GenerateRFPDocumentResponse> => {
      if (!projectId) throw new Error('projectId is required');
      const result = await trigger({
        projectId,
        opportunityId,
        documentType: 'TEAM_QUALIFICATIONS',
      });
      await refreshDocuments();
      return result;
    }, [trigger, refreshDocuments, projectId, opportunityId]);

  return {
    generateTeamQualifications,
    isGenerating: isMutating || isDocumentGenerating,
    teamQualificationsDocument,
    isDocumentsLoading,
  };
};

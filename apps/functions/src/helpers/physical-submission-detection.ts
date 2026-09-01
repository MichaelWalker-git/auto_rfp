import { formatFoiaComponentAddress, type SubmissionMethodDetected } from '@auto-rfp/core';
import { getOpportunity, updateOpportunity } from '@/helpers/opportunity';
import { syncPhysicalSubmissionLabel } from '@/helpers/linear';
import { scanPhysicalSubmission } from '@/helpers/executive-opportunity-brief';

const VALID_SUBMISSION_METHODS: readonly SubmissionMethodDetected[] = ['ELECTRONIC', 'PHYSICAL', 'BOTH', 'UNKNOWN'];

const asValidSubmissionMethod = (value: unknown): SubmissionMethodDetected | undefined =>
  typeof value === 'string' && (VALID_SUBMISSION_METHODS as readonly string[]).includes(value)
    ? (value as SubmissionMethodDetected)
    : undefined;

/**
 * Detects the physical-submission method for a brief's raw solicitation text,
 * persists it (plus FOIA address auto-fill and Linear label sync), and never
 * throws — a detection or persistence failure must never fail brief generation.
 *
 * Detection priority (ADR-001): the deterministic regex scan takes precedence;
 * the LLM's extraction from the summary prompt is only used as a fallback when
 * the scan finds no explicit language.
 */
export const detectAndPersistPhysicalSubmission = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  rawText: string;
  llmSubmissionMethod?: unknown;
  llmSubmissionRationale?: unknown;
}): Promise<void> => {
  const { orgId, projectId, oppId, rawText, llmSubmissionMethod, llmSubmissionRationale } = args;

  try {
    const scanResult = scanPhysicalSubmission(rawText);
    const fallbackMethod = scanResult ? undefined : asValidSubmissionMethod(llmSubmissionMethod);
    const result = scanResult ?? (fallbackMethod
      ? {
          submissionMethod: fallbackMethod,
          submissionMailingAddress: null,
          submissionMethodRationale:
            typeof llmSubmissionRationale === 'string' ? llmSubmissionRationale.slice(0, 500) : null,
        }
      : null);

    if (!result) return;

    const opp = await getOpportunity({ orgId, projectId, oppId });
    const formattedFoiaAddress = result.submissionMailingAddress
      ? formatFoiaComponentAddress(result.submissionMailingAddress)
      : undefined;
    const shouldFillFoiaAddress = !!formattedFoiaAddress && !opp?.item?.foiaContactAddress?.trim();

    await updateOpportunity({
      orgId,
      projectId,
      oppId,
      patch: {
        submissionMethod: result.submissionMethod,
        submissionMailingAddress: result.submissionMailingAddress,
        submissionMethodRationale: result.submissionMethodRationale,
        ...(shouldFillFoiaAddress ? { foiaContactAddress: formattedFoiaAddress } : {}),
      },
    });

    await syncPhysicalSubmissionLabel(oppId, opp?.item?.noticeId, result.submissionMethod);
  } catch (err) {
    console.warn('[physical-submission] Failed to detect/persist physical-submission method:', (err as Error)?.message);
  }
};

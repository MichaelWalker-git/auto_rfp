import { z } from 'zod';
import { SolutionPlanErrorCodeSchema, type SolutionPlanErrorCode } from '@auto-rfp/core';

/** The loose shape of an ApiError thrown by `apiMutate`. */
const ErrorShapeSchema = z.object({
  message: z.string().optional(),
  status: z.number().optional(),
  details: z.unknown().optional(),
});

/** The body of a 409 from PATCH /solution-plan/update carries a `code`. */
const CodeDetailsSchema = z.object({ code: SolutionPlanErrorCodeSchema });

const SAVE_ERROR_DESCRIPTIONS: Partial<Record<SolutionPlanErrorCode, string>> = {
  SOLUTION_PLAN_CONFLICT:
    'The plan changed while you were editing — reload to pick up the latest version, then reapply your edits.',
  SOLUTION_PLAN_NOT_READY:
    'The plan is not editable right now — a run may be in progress. Refresh and try again.',
};

const FALLBACK_DESCRIPTION = 'Could not save the Solution Plan.';

/**
 * Toast description for a failed PATCH /solution-plan/update: a specific hint
 * for the known 409 codes (ADR-8 not-READY refusal, ADR-11 version conflict),
 * otherwise the API error message.
 */
export const getSaveErrorDescription = (err: unknown): string => {
  const { success, data } = ErrorShapeSchema.safeParse(err);
  if (!success) return FALLBACK_DESCRIPTION;

  if (data.status === 409) {
    const { success: hasCode, data: details } = CodeDetailsSchema.safeParse(data.details);
    const specific = hasCode ? SAVE_ERROR_DESCRIPTIONS[details.code] : undefined;
    if (specific) return specific;
  }

  return data.message || FALLBACK_DESCRIPTION;
};

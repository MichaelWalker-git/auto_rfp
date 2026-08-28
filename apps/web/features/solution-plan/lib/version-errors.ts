import { z } from 'zod';

/**
 * Plain-language outcome mapping for the version-history mutations (W4–W6).
 * Mirrors `save-errors.ts`: the API's status + machine-readable `code` decide
 * the message; the UI never surfaces a raw code (stories' plain-language rule).
 */

/**
 * 409 `code` values pinned by u2/u3's version handlers (contracts C1/C2).
 * They are endpoint-specific and intentionally NOT part of core's
 * `SolutionPlanErrorCodeSchema` (that enum covers update/init/gate).
 */
const VersionConflictCodeSchema = z.enum([
  'SOLUTION_PLAN_VERSION_CURRENT',
  'SOLUTION_PLAN_GENERATING',
]);

/** The loose shape of an `ApiError` thrown by `apiMutate`. */
const ErrorShapeSchema = z.object({
  status: z.number().optional(),
  details: z.unknown().optional(),
});

const CodeDetailsSchema = z.object({ code: VersionConflictCodeSchema });

export const VERSION_NOT_FOUND_MESSAGE = 'This version no longer exists.';

export const RESTORE_CURRENT_MESSAGE =
  'This is already the current version — there is nothing to restore.';
export const RESTORE_GENERATING_MESSAGE =
  'The plan is being generated — restore is unavailable until it finishes.';
export const RESTORE_FAILED_MESSAGE =
  "Couldn't restore the version. The plan was not changed — please try again.";

export const DELETE_CURRENT_MESSAGE =
  'This version is now the current version and cannot be deleted.';
export const DELETE_FAILED_MESSAGE = "Couldn't delete the version. Please try again.";

const readStatusAndCode = (
  err: unknown,
): { status?: number; code?: z.infer<typeof VersionConflictCodeSchema> } => {
  const { success, data } = ErrorShapeSchema.safeParse(err);
  if (!success) return {};
  const { success: hasCode, data: details } = CodeDetailsSchema.safeParse(data.details);
  return { status: data.status, code: hasCode ? details.code : undefined };
};

export type VersionRestoreFailure = {
  outcome: 'not-found' | 'current-conflict' | 'generating' | 'error';
  message: string;
};

/** Maps a failed POST /solution-plan/version/restore to its W4 outcome. */
export const mapRestoreError = (err: unknown): VersionRestoreFailure => {
  const { status, code } = readStatusAndCode(err);
  if (status === 404) return { outcome: 'not-found', message: VERSION_NOT_FOUND_MESSAGE };
  if (status === 409 && code === 'SOLUTION_PLAN_GENERATING') {
    return { outcome: 'generating', message: RESTORE_GENERATING_MESSAGE };
  }
  if (status === 409) return { outcome: 'current-conflict', message: RESTORE_CURRENT_MESSAGE };
  return { outcome: 'error', message: RESTORE_FAILED_MESSAGE };
};

export type VersionDeleteFailure = {
  outcome: 'not-found' | 'current-conflict' | 'error';
  message: string;
};

/** Maps a failed DELETE /solution-plan/version to its W6 outcome. */
export const mapDeleteError = (err: unknown): VersionDeleteFailure => {
  const { status } = readStatusAndCode(err);
  if (status === 404) return { outcome: 'not-found', message: VERSION_NOT_FOUND_MESSAGE };
  if (status === 409) return { outcome: 'current-conflict', message: DELETE_CURRENT_MESSAGE };
  return { outcome: 'error', message: DELETE_FAILED_MESSAGE };
};

export type VersionLabelFailure = { outcome: 'validation' | 'not-found' | 'error' };

/**
 * Maps a failed PATCH /solution-plan/version/label to its W5 outcome. A 400
 * is the server-side length rejection — the editor shows the SAME inline
 * validation message as the client check.
 */
export const mapLabelError = (err: unknown): VersionLabelFailure => {
  const { status } = readStatusAndCode(err);
  if (status === 400) return { outcome: 'validation' };
  if (status === 404) return { outcome: 'not-found' };
  return { outcome: 'error' };
};

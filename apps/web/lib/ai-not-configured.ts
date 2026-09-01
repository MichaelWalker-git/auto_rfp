import { z } from 'zod';

/**
 * Shared "AI is not configured for this organization" detection + copy.
 *
 * The backend surfaces this as an HTTP 409 with a JSON body
 * `{ code: "AI_NOT_CONFIGURED", message: "..." }` (see the Lambda
 * `AiNotConfiguredError`), and async pipelines record it as the answer
 * resolution / outcome `AI_NOT_CONFIGURED`.
 *
 * The web app has several heterogeneous fetchers — the shared `ApiError`
 * (body parsed into `.details`), a couple of feature-local `ApiError`s (raw
 * body kept in `.message`), and hooks that throw a plain `Error` with a
 * `.status`. {@link isAiNotConfiguredError} recognises the condition across all
 * of them so every surface can render the same shared state.
 */
export const AI_NOT_CONFIGURED_CODE = 'AI_NOT_CONFIGURED';

export const AI_NOT_CONFIGURED_TITLE = 'AI is not configured';

export const AI_NOT_CONFIGURED_DESCRIPTION =
  'An administrator must add a Bedrock API key in Organization Settings → Integrations before AI features can run.';

const AiNotConfiguredBodySchema = z.object({
  code: z.literal(AI_NOT_CONFIGURED_CODE),
  message: z.string().optional(),
});

const hasCodeField = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  (value as { code?: unknown }).code === AI_NOT_CONFIGURED_CODE;

/**
 * True when an unknown thrown value represents the org-not-configured 409,
 * regardless of which fetcher produced it.
 */
export const isAiNotConfiguredError = (err: unknown): boolean => {
  if (err === null || typeof err !== 'object') return false;
  const e = err as { code?: unknown; details?: unknown; message?: unknown };

  // Web typed error, or the shared ApiError with the parsed body in `.details`.
  if (e.code === AI_NOT_CONFIGURED_CODE) return true;
  if (hasCodeField(e.details)) return true;

  // Feature-local ApiError variants keep the raw JSON body in `.message`.
  if (typeof e.message === 'string' && e.message.includes(AI_NOT_CONFIGURED_CODE)) {
    try {
      return AiNotConfiguredBodySchema.safeParse(JSON.parse(e.message)).success;
    } catch {
      // The message is the code/sentinel itself, not a JSON envelope.
      return true;
    }
  }

  return false;
};

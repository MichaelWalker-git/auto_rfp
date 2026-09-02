/**
 * Typed "AI not configured" error for the per-org Bedrock key migration.
 *
 * Thrown by the Bedrock resolution path (see `bedrock-http-client.ts`) when an
 * organization has no valid key stored. It is deliberately distinct from a
 * generic failure so that:
 *   - synchronous REST surfaces map it to a 409 with `code: 'AI_NOT_CONFIGURED'`
 *     (via `httpErrorMiddleware`) that the frontend recognizes (ticket 10), and
 *   - async pipeline workers record it as the dedicated `AI_NOT_CONFIGURED`
 *     outcome rather than `GENERATION_FAILED` (ticket 11).
 *
 * There is NO shared-key fallback: an unconfigured org fails closed with this
 * error rather than silently borrowing another org's (or a global) key.
 */
export const AI_NOT_CONFIGURED_CODE = 'AI_NOT_CONFIGURED';

export class AiNotConfiguredError extends Error {
  readonly code = AI_NOT_CONFIGURED_CODE;
  /** HTTP status used when this surfaces through the REST error middleware. */
  readonly statusCode = 409;

  constructor(public readonly orgId: string, message?: string) {
    super(
      message ??
        `AI is not configured for this organization. An administrator must add a ` +
          `Bedrock API key in Organization Settings → Integrations.`,
    );
    this.name = 'AiNotConfiguredError';
  }
}

/**
 * Type guard usable across the Lambda/worker boundary. Matches both the class
 * instance and the structural shape (name/code), so it survives cases where the
 * prototype chain is lost (e.g. an error re-thrown after JSON round-tripping).
 */
export const isAiNotConfiguredError = (err: unknown): err is AiNotConfiguredError => {
  if (err instanceof AiNotConfiguredError) return true;
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: string; code?: string };
  return e.code === AI_NOT_CONFIGURED_CODE || e.name === 'AiNotConfiguredError';
};

/** Message of an unknown thrown value without unsafe `as Error` assertions. */
export const errorMessageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Thrown by helpers when a requested resource doesn't exist, so thin handlers can
 * map it to a 404 by TYPE rather than by matching the message text (which silently
 * breaks the moment a message is reworded). Prefer `isNotFoundError(err)` over
 * `instanceof` at call sites so it stays robust across bundling/module duplication.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Type-safe check for a NotFoundError that survives cross-bundle instanceof gaps. */
export const isNotFoundError = (err: unknown): err is NotFoundError =>
  err instanceof NotFoundError || (err instanceof Error && err.name === 'NotFoundError');

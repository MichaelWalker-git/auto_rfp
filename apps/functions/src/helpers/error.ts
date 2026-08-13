/** Message of an unknown thrown value without unsafe `as Error` assertions. */
export const errorMessageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

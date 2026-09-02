/** Newest of a set of ISO timestamps (ignoring nullish/unparseable), or undefined
 *  when none are usable. Used to pre-compute each step snapshot's `latestTimestamp`
 *  and the newest solicitation-upload timestamp the staleness layer compares against. */
export const newestTimestamp = (
  values: ReadonlyArray<string | null | undefined>,
): string | undefined => {
  let bestMs = Number.NEGATIVE_INFINITY;
  let best: string | undefined;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = value;
    }
  }
  return best;
};

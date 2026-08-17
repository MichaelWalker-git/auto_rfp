/** Format an ISO date string as "Jun 1, 2025", or null-safe em dash. */
export const formatRelatedDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/** Format a 0..1 relevance score as a percentage badge label (e.g. "82% match"). */
export const formatMatchScore = (score?: number | null): string | null => {
  if (score == null) return null;
  return `${Math.round(score * 100)}% match`;
};

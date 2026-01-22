/**
 * Calculate days from now until deadline date (ISO string)
 */
export function calculateDaysUntil(dateTimeIso?: string | null): number | null {
    if (!dateTimeIso) return null;

    try {
        const now = new Date();
        const deadline = new Date(dateTimeIso);
        const diffTime = deadline.getTime() - now.getTime();
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    } catch {
        return null;
    }
}

/**
 * Get warning level based on days until deadline
 */

export type WarningLevel =
  | 'urgent'
  | 'upcoming'
  | 'future'
  | 'past'
  | null;

export function getWarningLevel(
  days: number | null
): WarningLevel {
  if (days === null) return null;
  if (days < 0) return 'past';
  if (days < 3) return 'urgent';
  if (days <= 7) return 'upcoming';
  return 'future';
}

/**
 * Calculate recommended submit time (24 hours early)
 */
export function calculateRecommendedSubmitBy(dateTimeIso?: string | null): string | null {
    if (!dateTimeIso) return null;

    try {
        const deadline = new Date(dateTimeIso);
        deadline.setHours(deadline.getHours() - 24);
        return deadline.toISOString();
    } catch {
        return null;
    }
}
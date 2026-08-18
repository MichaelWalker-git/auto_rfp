import type { DisclosureLevel } from '@auto-rfp/core';

/**
 * Frontend mirror of the backend disclosure gate (fail-closed). Used for
 * rendering the warning badge next to a match/project. Redaction itself always
 * happens server-side on the generation path — this is display only.
 */
export const getEffectiveDisclosure = (project: {
  disclosure?: DisclosureLevel | null;
  disclosureConfirmed?: boolean | null;
}): DisclosureLevel => {
  if (!project.disclosureConfirmed) return 'PERMISSION_REQUIRED';
  return project.disclosure ?? 'PERMISSION_REQUIRED';
};

/**
 * The level to pre-select when *editing* a row's disclosure. A confirmed row
 * must show its confirmed value — never the stale AI proposal. Only unconfirmed
 * rows pre-select the AI proposal so the reviewer sees the suggestion.
 */
export const getPendingDisclosure = (project: {
  disclosure?: DisclosureLevel | null;
  disclosureConfirmed?: boolean | null;
  disclosureProposed?: DisclosureLevel | null;
}): DisclosureLevel =>
  project.disclosureConfirmed
    ? project.disclosure ?? 'PERMISSION_REQUIRED'
    : project.disclosureProposed ?? project.disclosure ?? 'PERMISSION_REQUIRED';

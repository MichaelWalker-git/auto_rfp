import type { DisclosureLevel, PastProject } from '@auto-rfp/core';

/**
 * Disclosure gate — the single choke point for NDA / permission gating of
 * past-performance projects. Pure functions, no I/O, fully unit-testable.
 *
 * Every generation and matching surface routes through these helpers instead
 * of interpolating `project.client` directly, so a project that may not be
 * named cannot leak its client identity into an LLM prompt or a generated
 * document.
 */

/**
 * Authoritative disclosure for gating decisions. Fail-closed:
 *  - unconfirmed rows are treated as PERMISSION_REQUIRED regardless of stored value
 *  - a missing value is PERMISSION_REQUIRED
 * An AI proposal alone never relaxes gating — only a human-confirmed row does.
 */
export const getEffectiveDisclosure = (
  project: Pick<PastProject, 'disclosure' | 'disclosureConfirmed'>,
): DisclosureLevel => {
  if (!project.disclosureConfirmed) return 'PERMISSION_REQUIRED';
  return project.disclosure ?? 'PERMISSION_REQUIRED';
};

/** DO_NOT_USE projects are excluded from matching entirely. */
export const isUsableInMatching = (
  project: Pick<PastProject, 'disclosure' | 'disclosureConfirmed'>,
): boolean => getEffectiveDisclosure(project) !== 'DO_NOT_USE';

/** Only NAMEABLE projects may surface the real client name. */
export const isNameable = (
  project: Pick<PastProject, 'disclosure' | 'disclosureConfirmed'>,
): boolean => getEffectiveDisclosure(project) === 'NAMEABLE';

/**
 * In-band instruction to attach to a non-NAMEABLE project block so the LLM is
 * told not to *reconstruct* the client name (belt-and-suspenders with the
 * free-text scrub, which removes the stored name but can't stop the model from
 * inferring a brand/alias from surrounding context). Empty string for NAMEABLE.
 */
export const anonymizationNotice = (
  project: Pick<PastProject, 'disclosure' | 'disclosureConfirmed'>,
): string =>
  isNameable(project)
    ? ''
    : '⚠️ CONFIDENTIAL CLIENT: Do NOT name this client in the output. Refer to it only by ' +
      'domain/industry (e.g. "a federal healthcare client"). Do not infer, expand, or guess the ' +
      'name from any partial reference, abbreviation, or well-known brand.';

const anonymizedClientLabel = (project: Pick<PastProject, 'domain'>): string =>
  project.domain
    ? `[Client name withheld — ${project.domain} engagement]`
    : '[Client name withheld]';

const WITHHELD_TOKEN = '[client withheld]';

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Redact every occurrence of an identifying name from a free-text field.
 * The structured `client` field is not enough — the client name is frequently
 * embedded in `description` / `technicalApproach` / `achievements` (e.g.
 * "enabled DegreeData to automate..."), which the LLM reads verbatim.
 *
 * Matches are case-insensitive and bounded by non-word characters so we don't
 * mangle substrings of unrelated words. Names shorter than 3 chars are skipped
 * (too generic to safely blanket-replace).
 */
const scrubNames = (text: string | null | undefined, names: string[]): string | null | undefined => {
  if (!text) return text;
  let out = text;
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length < 3) continue;
    const re = new RegExp(`(^|[^\\w])${escapeRegExp(trimmed)}(?=[^\\w]|$)`, 'gi');
    out = out.replace(re, `$1${WITHHELD_TOKEN}`);
  }
  return out;
};

/** Fallback title when scrubbing removes the entire (client-derived) title. */
const CONFIDENTIAL_TITLE = '[Confidential project]';

/**
 * Return a copy safe to feed into any generation path. For non-NAMEABLE
 * projects the client name, client POC, and contract number are scrubbed — AND
 * the client name (plus POC name/organization) is stripped from the free-text
 * fields an LLM reads verbatim (title, description, technicalApproach,
 * achievements). The title matters most: extraction-created projects routinely
 * embed the client in it (e.g. "DegreeData Transcript Modernization"), and it
 * is rendered deterministically in the brief DOCX export where no LLM is in the
 * loop to honor the anonymization notice.
 * DO_NOT_USE should already be filtered out before this point; if it slips
 * through we still redact (defense in depth).
 */
export const redactForGeneration = <T extends PastProject>(project: T): T => {
  if (isNameable(project)) return project;

  // Identifying strings to strip from free text: the client name and any POC
  // name / organization that could re-identify the engagement.
  const names = [
    project.client,
    project.clientPOC?.name ?? undefined,
    project.clientPOC?.organization ?? undefined,
  ].filter((n): n is string => !!n && n.trim().length > 0);

  // `title` is a required non-empty field. If scrubbing leaves it empty or with
  // only the withheld token, fall back to a sensible placeholder so downstream
  // renderers still show something meaningful.
  const scrubbedTitle = scrubNames(project.title, names);
  const strippedTitle = (scrubbedTitle ?? '').replace(new RegExp(escapeRegExp(WITHHELD_TOKEN), 'gi'), '').trim();
  const title = strippedTitle.length > 0 ? (scrubbedTitle as string) : CONFIDENTIAL_TITLE;

  return {
    ...project,
    title,
    client: anonymizedClientLabel(project),
    clientPOC: null,
    contractNumber: null,
    description: scrubNames(project.description, names) ?? project.description,
    technicalApproach: scrubNames(project.technicalApproach, names),
    achievements: (project.achievements ?? []).map((a) => scrubNames(a, names) as string),
  };
};

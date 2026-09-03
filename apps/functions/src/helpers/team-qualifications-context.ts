/**
 * team-qualifications-context.ts
 *
 * Grounded personnel context for TEAM_QUALIFICATIONS generation
 * (team-definition U4, FR4.1). Assembles the transient
 * TeamQualificationsContext from the PERSISTED plan team (U3's saved team is
 * the single source downstream documents read), the referenced Employee
 * records (U1), and each member's CV text via `resumeRef` (org documents).
 *
 * U4 persists nothing — the context is rebuilt on every generation run.
 * Personnel content is grounded EXCLUSIVELY here (BR2.1): the prompt's
 * knowledge-base context stays legitimate for corporate capabilities, but
 * never for personnel.
 *
 * Line classification follows BR2.5's fixed detection order, with a defensive
 * fallback: a FILLED line whose Employee lookup misses degrades to DELETED
 * (snapshot-only, pending replacement) with a data-integrity warning —
 * generation never fails on a stale reference.
 */

import type {
  EmployeeItem,
  PlanTeamMember,
  SolutionPlanDBItem,
  SolutionPlanKey,
} from '@auto-rfp/core';

import { requireEnv } from './env';
import { getSolutionPlanByOpportunity } from './solution-plan';
import { listEmployeesByOrg } from './employee';
import { getDocumentItemByDocumentId } from './document';
import { buildTextKeyCandidates, loadDocumentText } from './document-text';
import { errorMessageOf } from './error';

// ─── Budgets ──────────────────────────────────────────────────────────────────

/**
 * Per-member cap for injected CV text. Keeps one oversized resume from
 * starving the rest of the roster.
 */
export const TEAM_MEMBER_CV_TEXT_BUDGET = 4_000;

/**
 * Character budget for the whole rendered SAVED TEAM block — its own budget
 * (the SOLUTION_PLAN_TEXT_BUDGET precedent, ADR-6), separate from the 18k
 * `gatherAllContext` enrichment blob.
 */
export const TEAM_CONTEXT_TEXT_BUDGET = 24_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/** BR2.5 line shapes; INVALID covers any shape outside the U3 contract. */
export type TeamLineClassification = 'UNFILLED' | 'DELETED' | 'FILLED' | 'INVALID';

/** A FILLED team line cited with structured fields + CV text where resolvable (BR2.2). */
export interface TeamQualificationsMember {
  nameSnapshot: string;
  role: string;
  certifications: string[];
  location?: string;
  rationale?: string;
  /** Extracted CV text (per-member budget applied); null when unresolvable. */
  cvText: string | null;
  /** Why the bio source is missing — noted in the rendered block (BR2.2). */
  cvMissingReason?: string;
}

/** A removed-employee line — snapshot only, no qualification claims (BR2.3). */
export interface TeamQualificationsPendingReplacement {
  nameSnapshot: string;
  role: string;
}

/** The transient grounding bundle the TEAM_QUALIFICATIONS prompt receives. */
export interface TeamQualificationsContext {
  opportunityId: string;
  members: TeamQualificationsMember[];
  openRoles: string[];
  pendingReplacements: TeamQualificationsPendingReplacement[];
}

// ─── Classification (BR2.5) ───────────────────────────────────────────────────

/**
 * Classify one team line by the plan-team unit's declared fields, in the
 * FIXED detection order (BR2.5):
 *   1. no employeeId AND no nameSnapshot → UNFILLED
 *   2. removedEmployee                   → DELETED
 *   3. employeeId present                → FILLED
 *   4. anything else                     → INVALID (logged, cited as pending
 *      replacement rather than dropped)
 */
export const classifyTeamLine = (member: PlanTeamMember): TeamLineClassification => {
  if (!member.employeeId && !member.nameSnapshot) return 'UNFILLED';
  if (member.removedEmployee) return 'DELETED';
  if (member.employeeId) return 'FILLED';
  console.warn(
    `[team-qualifications] Data-integrity warning: team line for role "${member.role}" has an ` +
      'invalid shape (nameSnapshot without employeeId, not marked removed) — citing as pending replacement',
  );
  return 'INVALID';
};

// ─── Saved-team precondition (BR1.1) ──────────────────────────────────────────

/**
 * "Saved team" = the plan item has a persisted `planTeam` with at least one
 * member. An auto-attached synthesis team qualifies — the rule keys on
 * persistence, not `savedAt`/`userModified`.
 */
export const hasSavedTeam = (
  plan: Pick<SolutionPlanDBItem, 'planTeam'> | null | undefined,
): boolean => Boolean(plan?.planTeam && plan.planTeam.members.length > 0);

// ─── CV text loading (BR2.2) ──────────────────────────────────────────────────

const TEXT_READY_STATUSES = new Set(['TEXT_EXTRACTED', 'CHUNKED', 'INDEXED', 'ready']);

/**
 * Resolve a member's CV text via `resumeRef` → org document → `textFileKey` →
 * S3. Every failure degrades to structured-fields-only with the missing bio
 * source noted — assembly never fails on a CV read (BR2.2).
 */
const loadCvText = async (
  employee: EmployeeItem,
): Promise<{ cvText: string | null; cvMissingReason?: string }> => {
  if (!employee.resumeRef) {
    return { cvText: null, cvMissingReason: 'no resume/CV on file' };
  }
  try {
    const document = await getDocumentItemByDocumentId(employee.resumeRef);
    if (!document || buildTextKeyCandidates(document).length === 0) {
      return {
        cvText: null,
        cvMissingReason: 'resume reference does not resolve to a document with extracted text',
      };
    }
    // Only attempt to load text if the pipeline has run.
    const isTextReady = !document.indexStatus || TEXT_READY_STATUSES.has(document.indexStatus);
    if (!isTextReady) {
      return {
        cvText: null,
        cvMissingReason: 'resume document is still being processed',
      };
    }
    const text = await loadDocumentText(requireEnv('DOCUMENTS_BUCKET'), document);
    if (!text.trim()) {
      return { cvText: null, cvMissingReason: 'resume document text is empty' };
    }
    return { cvText: text.trim().slice(0, TEAM_MEMBER_CV_TEXT_BUDGET) };
  } catch (err) {
    // Recoverable: a failed S3/DB read degrades to structured fields alone.
    console.warn(
      `[team-qualifications] Failed to load CV text for employee ${employee.id} ` +
        `(resumeRef=${employee.resumeRef}): ${errorMessageOf(err)}`,
    );
    return { cvText: null, cvMissingReason: 'resume text could not be loaded' };
  }
};

// ─── Assembly (BR2.1–BR2.5) ───────────────────────────────────────────────────

/**
 * Assemble the TeamQualificationsContext from the persisted plan team.
 *
 * Reads `plan.planTeam` DIRECTLY (not `getDerivedPlanTeam` — that is the UI
 * derivation; U4 does its own BR2.5 classification and Employee lookups so
 * the data-integrity warning path stays visible).
 *
 * Returns null when there is no saved team (the worker marks the run FAILED;
 * the request-path guard normally refuses long before this, BR1.1).
 */
export const assembleTeamQualificationsContext = async (
  key: SolutionPlanKey,
): Promise<TeamQualificationsContext | null> => {
  const plan = await getSolutionPlanByOpportunity(key);
  const teamLines = plan?.planTeam?.members ?? [];
  if (!hasSavedTeam(plan) || teamLines.length === 0) return null;

  // Load the org pool ONCE; per-line lookups hit the map.
  const employees = await listEmployeesByOrg(key.orgId);
  const employeesById = new Map(employees.map((employee) => [employee.id, employee]));

  const members: TeamQualificationsMember[] = [];
  const openRoles: string[] = [];
  const pendingReplacements: TeamQualificationsPendingReplacement[] = [];

  for (const line of teamLines) {
    const classification = classifyTeamLine(line);

    if (classification === 'UNFILLED') {
      // Open role — no personnel claims (BR2.3).
      openRoles.push(line.role);
      continue;
    }

    if (classification === 'DELETED' || classification === 'INVALID') {
      // Snapshot-only, marked pending replacement; never dropped (BR2.3/BR2.5).
      pendingReplacements.push({
        nameSnapshot: line.nameSnapshot ?? '(name unavailable)',
        role: line.role,
      });
      continue;
    }

    // FILLED — read the Employee record (classification guarantees employeeId).
    const employee = line.employeeId ? employeesById.get(line.employeeId) : undefined;
    if (!employee) {
      // BR2.5 defensive fallback: stale reference degrades to DELETED with a
      // data-integrity warning — generation never fails on it.
      console.warn(
        `[team-qualifications] Data-integrity warning: FILLED team line references ` +
          `employee ${line.employeeId} not found in org ${key.orgId} pool — treating as pending replacement`,
      );
      pendingReplacements.push({
        nameSnapshot: line.nameSnapshot ?? '(name unavailable)',
        role: line.role,
      });
      continue;
    }

    const { cvText, cvMissingReason } = await loadCvText(employee);
    members.push({
      nameSnapshot: line.nameSnapshot ?? employee.name,
      role: line.role,
      certifications: employee.certifications,
      ...(employee.location ? { location: employee.location } : {}),
      ...(line.rationale ? { rationale: line.rationale } : {}),
      cvText,
      ...(cvMissingReason ? { cvMissingReason } : {}),
    });
  }

  return { opportunityId: key.opportunityId, members, openRoles, pendingReplacements };
};

// ─── Rendering ────────────────────────────────────────────────────────────────

const renderMember = (member: TeamQualificationsMember, index: number): string => {
  const lines: string[] = [`${index + 1}. ${member.nameSnapshot} — ${member.role}`];
  if (member.certifications.length > 0) {
    lines.push(`   Certifications: ${member.certifications.join(', ')}`);
  }
  if (member.location) lines.push(`   Location: ${member.location}`);
  if (member.rationale) lines.push(`   Match rationale: ${member.rationale}`);
  if (member.cvText) {
    lines.push('   Resume/CV extract:', '   """', member.cvText, '   """');
  } else {
    lines.push(
      `   Resume/CV: not available (${member.cvMissingReason ?? 'unknown reason'}) — ` +
        'cite ONLY the structured fields above for this person.',
    );
  }
  return lines.join('\n');
};

/**
 * Render the context as the plain-text SAVED TEAM roster injected into the
 * user prompt. Truncated to TEAM_CONTEXT_TEXT_BUDGET as a safety net — the
 * per-member CV cap should keep it well below.
 */
export const renderTeamContextBlock = (context: TeamQualificationsContext): string => {
  const sections: string[] = [`SAVED TEAM ROSTER (opportunity ${context.opportunityId})`];

  if (context.members.length > 0) {
    sections.push(
      `FILLED POSITIONS (${context.members.length}):\n${context.members
        .map(renderMember)
        .join('\n\n')}`,
    );
  }

  if (context.openRoles.length > 0) {
    sections.push(
      'OPEN ROLES (not yet filled — present as open positions; make NO personnel claims for these):\n' +
        context.openRoles.map((role) => `- ${role}`).join('\n'),
    );
  }

  if (context.pendingReplacements.length > 0) {
    sections.push(
      'PENDING REPLACEMENT (former team members — cite name and role ONLY, marked as pending replacement; no qualification claims beyond the snapshot):\n' +
        context.pendingReplacements
          .map((entry) => `- ${entry.nameSnapshot} — ${entry.role}`)
          .join('\n'),
    );
  }

  const block = sections.join('\n\n');
  if (block.length > TEAM_CONTEXT_TEXT_BUDGET) {
    console.warn(
      `[team-qualifications] Rendered team context truncated: length=${block.length} ` +
        `exceeds budget=${TEAM_CONTEXT_TEXT_BUDGET}`,
    );
    return block.slice(0, TEAM_CONTEXT_TEXT_BUDGET);
  }
  return block;
};

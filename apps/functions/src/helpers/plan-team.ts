/**
 * plan-team.ts
 *
 * Persistence for the plan-embedded team (team-definition U3, ADR-002): the
 * PlanTeam lives as a structured field on the solution plan item — no storage
 * identity of its own — and the SAVED team is the single source downstream
 * documents read (BR3.2).
 *
 * `removedEmployee` is DERIVED ON READ (the pinned design decision): whenever
 * the team is served or saved, every referenced employeeId is checked against
 * the org pool via U1's helpers — a live reference refreshes the name
 * snapshot, a dangling one drops the employeeId and marks the line (BR3.3).
 * No U1-side cascade, no batch job.
 */

import type {
  PlanTeam,
  PlanTeamMember,
  SolutionPlanDBItem,
  SolutionPlanKey,
  EmployeeItem,
} from '@auto-rfp/core';

import { SOLUTION_PLAN_PK } from '@/constants/solution-plan';
import { updateItem } from './db';
import { nowIso } from './date';
import { listEmployeesByOrg } from './employee';
import { buildSolutionPlanSk, getSolutionPlanByOpportunity } from './solution-plan';
import { generateTeamRecommendation } from './team-matching';

// ─── Derive-on-read (BR3.3) ─────────────────────────────────────────────────────

/**
 * Reconcile member lines against the live pool:
 *  - FILLED line whose employee exists → refresh nameSnapshot, clear the mark
 *  - FILLED line whose employee is gone → drop employeeId, keep the snapshot
 *    and rationale, set removedEmployee (the DELETED-employee shape, BR3.3)
 *  - previously-DELETED line whose employee is unknown stays as-is; lines
 *    without an employee reference (UNFILLED) pass through untouched
 */
export const deriveTeamMembers = (
  members: PlanTeamMember[],
  employeesById: ReadonlyMap<string, EmployeeItem>,
): PlanTeamMember[] =>
  members.map((member) => {
    if (!member.employeeId) return member;

    const employee = employeesById.get(member.employeeId);
    if (employee) {
      return { ...member, nameSnapshot: employee.name, removedEmployee: false };
    }

    // The referenced employee left the pool — render from snapshots, marked,
    // never silently dropped (BR3.3). Rationale is retained.
    const { employeeId: _removed, ...snapshot } = member;
    return { ...snapshot, removedEmployee: true };
  });

const poolById = async (orgId: string): Promise<Map<string, EmployeeItem>> => {
  const employees = await listEmployeesByOrg(orgId);
  return new Map(employees.map((e) => [e.id, e]));
};

// ─── Persistence primitives ─────────────────────────────────────────────────────

/**
 * Write the whole PlanTeam map onto the plan item. Explicit user mutations
 * (save, regenerate) bump the plan's monotonic version — the same audit
 * semantics as a content edit; the synthesis-attach path doesn't (synthesis
 * itself just bumped it).
 */
const writePlanTeam = async (
  key: SolutionPlanKey,
  team: PlanTeam,
  options?: { bumpVersionFrom?: number },
): Promise<void> => {
  await updateItem<SolutionPlanDBItem>(SOLUTION_PLAN_PK, buildSolutionPlanSk(key), {
    planTeam: team,
    ...(options?.bumpVersionFrom !== undefined ? { version: options.bumpVersionFrom + 1 } : {}),
  });
};

// ─── Read (W2) ──────────────────────────────────────────────────────────────────

export interface GetPlanTeamResult {
  planExists: boolean;
  /** Derived team — null when the plan has no team yet (prerequisite/pre-synthesis state). */
  team: PlanTeam | null;
}

/**
 * Serve the persisted team with `removedEmployee` derived against the pool.
 * Read-only — the derived marks are returned, not written back; the next save
 * persists them as a side effect.
 */
export const getDerivedPlanTeam = async (key: SolutionPlanKey): Promise<GetPlanTeamResult> => {
  const plan = await getSolutionPlanByOpportunity(key);
  if (!plan) return { planExists: false, team: null };

  const team = plan.planTeam ?? null;
  if (!team || !team.members.some((m) => m.employeeId)) {
    return { planExists: true, team };
  }

  const employees = await poolById(key.orgId);
  return {
    planExists: true,
    team: { ...team, members: deriveTeamMembers(team.members, employees) },
  };
};

// ─── Save (W3, BR3.1) ───────────────────────────────────────────────────────────

/**
 * Persist a human-edited team: reconcile every line against the live pool
 * (snapshots refreshed, dangling references marked), set `userModified` +
 * `savedAt` (BR3.1), keep `generatedAt` from the recommendation the edit
 * started from, and bump the plan version. Returns null when the plan
 * doesn't exist.
 */
export const saveUserEditedTeam = async (
  key: SolutionPlanKey,
  members: PlanTeamMember[],
): Promise<PlanTeam | null> => {
  const plan = await getSolutionPlanByOpportunity(key);
  if (!plan) return null;

  const employees = await poolById(key.orgId);
  const team: PlanTeam = {
    members: deriveTeamMembers(members, employees),
    userModified: true,
    savedAt: nowIso(),
    ...(plan.planTeam?.generatedAt ? { generatedAt: plan.planTeam.generatedAt } : {}),
  };

  await writePlanTeam(key, team, { bumpVersionFrom: plan.version });
  return team;
};

// ─── Synthesis attach (W1, BR1.1/BR1.2) ─────────────────────────────────────────

export type AttachGeneratedTeamOutcome = 'ATTACHED' | 'PRESERVED_USER_MODIFIED' | 'EMPTY_POOL';

/**
 * Called by the solution-plan worker after synthesis completes: propose a
 * fresh team and attach it (BR1.1) — UNLESS the existing team is
 * user-modified, which is preserved untouched and the fresh recommendation
 * discarded before it is even generated (BR1.2). An empty pool leaves the
 * team as-is — the section shows the prerequisite state (BR4.1).
 *
 * @throws TeamMatchingError (and plan-read errors) — the worker catches, logs
 *         and continues: the plan still completes (BR4.2).
 */
export const attachGeneratedTeam = async (
  key: SolutionPlanKey,
): Promise<AttachGeneratedTeamOutcome> => {
  const plan = await getSolutionPlanByOpportunity(key);
  if (!plan) throw new Error(`No solution plan for opportunity ${key.opportunityId}`);

  if (plan.planTeam?.userModified) {
    return 'PRESERVED_USER_MODIFIED';
  }

  const result = await generateTeamRecommendation(key);
  if (result.emptyPool) return 'EMPTY_POOL';

  await writePlanTeam(key, {
    members: result.members,
    userModified: false,
    generatedAt: nowIso(),
  });
  return 'ATTACHED';
};

// ─── Explicit regenerate (W4) ───────────────────────────────────────────────────

export type RegenerateTeamResult =
  | { status: 'REGENERATED'; team: PlanTeam }
  | { status: 'EMPTY_POOL' }
  | { status: 'PLAN_NOT_FOUND' };

/**
 * The explicit team-regenerate action (W4): a fresh recommendation REPLACES
 * the team — even a user-modified one (the caller confirmed) — `userModified`
 * resets to false and `savedAt` clears (BR1.2). Matching failure throws
 * (TeamMatchingError) BEFORE anything is written, so the existing team stays
 * untouched (BR4.2).
 */
export const regenerateTeam = async (key: SolutionPlanKey): Promise<RegenerateTeamResult> => {
  const plan = await getSolutionPlanByOpportunity(key);
  if (!plan) return { status: 'PLAN_NOT_FOUND' };

  const result = await generateTeamRecommendation(key);
  if (result.emptyPool) return { status: 'EMPTY_POOL' };

  const team: PlanTeam = {
    members: result.members,
    userModified: false,
    generatedAt: nowIso(),
  };
  await writePlanTeam(key, team, { bumpVersionFrom: plan.version });
  return { status: 'REGENERATED', team };
};

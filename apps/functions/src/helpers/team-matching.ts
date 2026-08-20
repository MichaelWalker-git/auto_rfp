/**
 * team-matching.ts
 *
 * The plan-team matching engine (team-definition U3, ADR-003): loads the
 * org's FULL employee pool via U1's read helpers (no vector index), sizes the
 * team one member per staffing plan position (BR1.3 — AI proposes role slots
 * from the solicitation requirements when no staffing plan exists), scores
 * candidates deterministically (role-name fit, certifications, location) and
 * makes ONE Bedrock HTTP call to rank candidates and write the
 * one-or-two-sentence rationale per recommended member (BR1.4).
 *
 * Failure contract (BR4.2): every error is wrapped in `TeamMatchingError` so
 * callers can always distinguish "matching broke" from "the plan broke" —
 * matching must never block the plan. An empty pool is NOT an error: it
 * returns `{ emptyPool: true }`, the prerequisite state (BR4.1).
 */

import { z } from 'zod';

import type { EmployeeItem, PlanTeamMember, SolutionPlanKey, StaffingPlan } from '@auto-rfp/core';

import { invokeModel } from './bedrock-http-client';
import { fetchExecutiveBriefAnalysis } from './db-tool-helpers';
import { loadSolicitation } from './document-generation';
import { listEmployeesByOrg } from './employee';
import { requireEnv } from './env';
import { errorMessageOf } from './error';
import { getStaffingPlansByOpportunity } from './pricing';
import { SOLUTION_PLAN_BRIEF_SECTIONS } from './solution-plan-prompts';

// ─── Config ─────────────────────────────────────────────────────────────────────

const SOLICITATION_CHAR_CAP = 12_000;
const EXEC_BRIEF_CHAR_CAP = 6_000;
/** Pre-ranked candidates shown to the model per staffing slot. */
const SHORTLIST_SIZE = 5;
/** Candidate cap for the no-staffing-plan (AI slot proposal) prompt. */
const MAX_CANDIDATES_IN_PROMPT = 40;
/** Slot cap when the AI proposes roles from the requirements (BR1.3). */
export const MAX_AI_PROPOSED_SLOTS = 8;
const MATCHING_MAX_TOKENS = 4_000;

/** Matching model — override via TEAM_MATCHING_MODEL_ID, falls back to the shared model. */
const resolveModelId = (): string =>
  process.env.TEAM_MATCHING_MODEL_ID || requireEnv('BEDROCK_MODEL_ID');

// ─── Typed failure (BR4.2) ──────────────────────────────────────────────────────

/**
 * Every matching failure surfaces as this type so callers (synthesis hook,
 * regenerate handler) can log/return it without ever failing the plan.
 */
export class TeamMatchingError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'TeamMatchingError';
    this.cause = cause;
  }
}

// ─── Deterministic scoring (BR5.2) ──────────────────────────────────────────────

/** Lowercased alphanumeric tokens (keeps +/# so "C#"/"CCNP+" style terms survive). */
export const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((token) => token.length > 1);

/** Token-overlap similarity between two role names, 0..1. */
export const roleSimilarity = (a: string, b: string): number => {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let common = 0;
  for (const token of tokensA) if (tokensB.has(token)) common += 1;
  return common / Math.max(tokensA.size, tokensB.size);
};

/**
 * Deterministic candidate score for one role slot: primary-role fit dominates,
 * secondary roles count half, certifications matching the solicitation
 * requirement vocabulary add up to 1, and a stated ONSHORE location gets a
 * small tie-break bonus (most federal work is delivery-location constrained).
 */
export const scoreCandidateForRole = (
  employee: EmployeeItem,
  role: string,
  requirementTokens?: ReadonlySet<string>,
): number => {
  const primaryFit = Math.max(0, ...employee.primaryRoles.map((r) => roleSimilarity(r, role)));
  const secondaryFit = Math.max(0, ...employee.secondaryRoles.map((r) => roleSimilarity(r, role)));

  let certScore = 0;
  if (requirementTokens && requirementTokens.size > 0) {
    const certTokens = new Set(employee.certifications.flatMap(tokenize));
    let hits = 0;
    for (const token of certTokens) if (requirementTokens.has(token)) hits += 1;
    certScore = Math.min(1, hits / 5);
  }

  const locationBonus = employee.location === 'ONSHORE' ? 0.25 : 0;

  return 3 * primaryFit + 1.5 * secondaryFit + certScore + locationBonus;
};

// ─── Slot sizing (BR1.3) ────────────────────────────────────────────────────────

export interface TeamSlot {
  role: string;
  /** The staffing plan line's position identifier (positions unique per plan). */
  staffingPositionRef?: string;
}

/**
 * One slot per unique staffing plan position (BR1.3). When the opportunity has
 * several staffing plans, the most recently updated one is authoritative.
 * Returns [] when no staffing plan exists — the AI then proposes role slots.
 */
export const deriveSlotsFromStaffingPlans = (plans: StaffingPlan[]): TeamSlot[] => {
  if (plans.length === 0) return [];
  const [latest] = [...plans].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));

  const seen = new Set<string>();
  const slots: TeamSlot[] = [];
  for (const item of latest.laborItems) {
    if (seen.has(item.position)) continue;
    seen.add(item.position);
    slots.push({ role: item.position, staffingPositionRef: item.position });
  }
  return slots;
};

// ─── Prompts ────────────────────────────────────────────────────────────────────

export const TEAM_MATCHING_SYSTEM_PROMPT = `You are an expert staffing lead assembling a delivery team for a government contract proposal. You are given the open team slots (or asked to propose them), the candidate employees of the organization, and excerpts of the solicitation context.

Rules:
- Assign at most one employee per slot, and prefer assigning DIFFERENT employees to different slots.
- Only use employee ids from the provided candidate list. Never invent an id.
- If no candidate reasonably fits a slot, set "employeeId" to null (the slot stays unfilled).
- For EVERY assigned employee, write a "rationale" of one or two plain-language sentences citing their strongest matching certifications and skills against the role and the solicitation requirements. An assignment without a rationale is invalid.

Respond ONLY with a single JSON object, no prose, in this exact shape:
{"slots":[{"role":string,"staffingPositionRef":string|null,"employeeId":string|null,"rationale":string|null}]}`;

const truncate = (text: string, cap: number): string =>
  text.length > cap ? `${text.slice(0, cap)}\n…[truncated]` : text;

const candidateLine = (employee: EmployeeItem): string =>
  JSON.stringify({
    id: employee.id,
    name: employee.name,
    primaryRoles: employee.primaryRoles,
    secondaryRoles: employee.secondaryRoles,
    certifications: employee.certifications,
    location: employee.location ?? null,
  });

/**
 * Build the single matching prompt. With staffing slots, each slot carries a
 * deterministically pre-ranked shortlist; without them, the model first
 * proposes the role slots from the requirements (BR1.3, Q2).
 */
export const buildTeamMatchingUserPrompt = (args: {
  slots: TeamSlot[];
  employees: EmployeeItem[];
  solicitationText: string;
  execBriefText: string;
  requirementTokens: ReadonlySet<string>;
}): string => {
  const { slots, employees, solicitationText, execBriefText, requirementTokens } = args;

  const contextParts = [
    execBriefText && `OPPORTUNITY ANALYSIS:\n${truncate(execBriefText, EXEC_BRIEF_CHAR_CAP)}`,
    solicitationText &&
      `SOLICITATION (excerpt):\n${truncate(solicitationText, SOLICITATION_CHAR_CAP)}`,
  ].filter(Boolean);

  if (slots.length > 0) {
    const slotBlocks = slots.map((slot) => {
      const shortlist = [...employees]
        .sort(
          (a, b) =>
            scoreCandidateForRole(b, slot.role, requirementTokens) -
            scoreCandidateForRole(a, slot.role, requirementTokens),
        )
        .slice(0, SHORTLIST_SIZE);
      return [
        `Slot role: ${slot.role}`,
        `staffingPositionRef: ${slot.staffingPositionRef ?? 'null'}`,
        'Pre-ranked candidates (best deterministic fit first):',
        ...shortlist.map(candidateLine),
      ].join('\n');
    });

    return [
      `Fill these ${slots.length} team slot(s) — one line per slot, keep the given role and staffingPositionRef exactly:`,
      slotBlocks.join('\n\n'),
      ...contextParts,
    ].join('\n\n');
  }

  const candidates = employees.slice(0, MAX_CANDIDATES_IN_PROMPT);
  return [
    `There is no staffing plan for this opportunity. First propose between 1 and ${MAX_AI_PROPOSED_SLOTS} role slots derived from the solicitation requirements (set "staffingPositionRef" to null on every slot), then assign the best candidate per slot.`,
    'Candidates:',
    candidates.map(candidateLine).join('\n'),
    ...contextParts,
  ].join('\n\n');
};

// ─── Model output parsing ───────────────────────────────────────────────────────

const MatchingModelResponseSchema = z.object({
  slots: z
    .array(
      z.object({
        role: z.string().min(1),
        staffingPositionRef: z.string().nullish(),
        employeeId: z.string().nullish(),
        rationale: z.string().nullish(),
      }),
    )
    .min(1),
});

type MatchingModelSlot = z.infer<typeof MatchingModelResponseSchema>['slots'][number];

/** Extract and validate the model's JSON object from its text response. */
export const parseMatchingResponse = (textContent: string): MatchingModelSlot[] | null => {
  const start = textContent.indexOf('{');
  const end = textContent.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const raw: unknown = JSON.parse(textContent.slice(start, end + 1));
    const { success, data } = MatchingModelResponseSchema.safeParse(raw);
    return success ? data.slots : null;
  } catch {
    return null;
  }
};

// ─── Member assembly ────────────────────────────────────────────────────────────

const unfilledLine = (slot: TeamSlot): PlanTeamMember => ({
  role: slot.role,
  ...(slot.staffingPositionRef ? { staffingPositionRef: slot.staffingPositionRef } : {}),
  removedEmployee: false,
  source: 'AI_RECOMMENDED',
});

const filledLine = (
  slot: TeamSlot,
  employee: EmployeeItem,
  rationale: string | undefined,
): PlanTeamMember => ({
  employeeId: employee.id,
  nameSnapshot: employee.name,
  role: slot.role,
  ...(slot.staffingPositionRef ? { staffingPositionRef: slot.staffingPositionRef } : {}),
  ...(rationale ? { rationale } : {}),
  removedEmployee: false,
  source: 'AI_RECOMMENDED',
});

/**
 * Convert model slots to team member lines. With fixed staffing slots the
 * output is forced to exactly one line per position, in staffing plan order
 * (BR1.3) — unmatched positions become UNFILLED lines. Employee references the
 * pool doesn't contain are treated as unfilled (hallucination guard).
 */
export const toTeamMembers = (
  modelSlots: MatchingModelSlot[],
  employeesById: ReadonlyMap<string, EmployeeItem>,
  fixedSlots: TeamSlot[],
): PlanTeamMember[] => {
  const buildLine = (slot: TeamSlot, output: MatchingModelSlot | undefined): PlanTeamMember => {
    const employee = output?.employeeId ? employeesById.get(output.employeeId) : undefined;
    if (!employee) return unfilledLine(slot);
    return filledLine(slot, employee, output?.rationale?.trim() || undefined);
  };

  if (fixedSlots.length > 0) {
    const remaining = [...modelSlots];
    return fixedSlots.map((slot) => {
      const index = remaining.findIndex(
        (s) => (s.staffingPositionRef ?? s.role) === (slot.staffingPositionRef ?? slot.role),
      );
      const output = index >= 0 ? remaining.splice(index, 1)[0] : undefined;
      return buildLine(slot, output);
    });
  }

  return modelSlots
    .slice(0, MAX_AI_PROPOSED_SLOTS)
    .map((output) => buildLine({ role: output.role }, output));
};

/** BR1.4 — a recommendation without rationale is invalid output. */
const hasMissingRationale = (members: PlanTeamMember[]): boolean =>
  members.some((m) => m.employeeId && !m.rationale);

/** Drop any still-rationale-less recommendation to an UNFILLED line (BR1.4 fallback). */
const dropRationaleLessToUnfilled = (members: PlanTeamMember[]): PlanTeamMember[] =>
  members.map((m) =>
    m.employeeId && !m.rationale
      ? unfilledLine({ role: m.role, staffingPositionRef: m.staffingPositionRef })
      : m,
  );

// ─── Bedrock call ───────────────────────────────────────────────────────────────

const invokeMatchingModel = async (userPrompt: string): Promise<MatchingModelSlot[]> => {
  const requestBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: MATCHING_MAX_TOKENS,
    temperature: 0.2,
    system: TEAM_MATCHING_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  };

  const responseBody = await invokeModel(resolveModelId(), JSON.stringify(requestBody));
  const parsed = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const textContent = parsed.content?.find((c) => c.type === 'text')?.text;
  if (!textContent) throw new TeamMatchingError('Empty Bedrock response for team matching');

  const slots = parseMatchingResponse(textContent);
  if (!slots) throw new TeamMatchingError('Unparseable Bedrock response for team matching');
  return slots;
};

// ─── Entry point ────────────────────────────────────────────────────────────────

export interface TeamMatchingResult {
  members: PlanTeamMember[];
  /** True when the org has no employees — the prerequisite state (BR4.1), never an error. */
  emptyPool: boolean;
}

/**
 * Produce the recommended team for one opportunity (W1 steps 2): full-pool
 * candidates (ADR-003), staffing-plan slot sizing (BR1.3), deterministic
 * pre-ranking + one Bedrock ranking/rationale call (BR1.4, BR5.2). A filled
 * recommendation missing its rationale triggers ONE full regeneration; any
 * line still missing it afterwards degrades to UNFILLED.
 *
 * @throws TeamMatchingError on any failure — callers never let it block the plan (BR4.2).
 */
export const generateTeamRecommendation = async (
  key: SolutionPlanKey,
): Promise<TeamMatchingResult> => {
  try {
    const employees = await listEmployeesByOrg(key.orgId);
    if (employees.length === 0) {
      return { members: [], emptyPool: true };
    }

    const [staffingPlans, solicitationText, execBriefText] = await Promise.all([
      getStaffingPlansByOpportunity(key.orgId, key.projectId, key.opportunityId),
      // Context is best-effort — matching can rank on the pool alone.
      loadSolicitation(key.projectId, key.opportunityId).catch(() => ''),
      fetchExecutiveBriefAnalysis(key.projectId, key.opportunityId, [
        ...SOLUTION_PLAN_BRIEF_SECTIONS,
      ]).catch(() => ''),
    ]);

    const slots = deriveSlotsFromStaffingPlans(staffingPlans);
    const requirementTokens: ReadonlySet<string> = new Set(
      tokenize(`${solicitationText} ${execBriefText}`.slice(0, 30_000)),
    );
    const employeesById = new Map(employees.map((e) => [e.id, e]));
    const userPrompt = buildTeamMatchingUserPrompt({
      slots,
      employees,
      solicitationText,
      execBriefText,
      requirementTokens,
    });

    let members = toTeamMembers(await invokeMatchingModel(userPrompt), employeesById, slots);
    if (hasMissingRationale(members)) {
      // BR1.4 — a recommendation without rationale is invalid output: regenerate once…
      console.warn('[team-matching] recommendation(s) missing rationale — regenerating once (BR1.4)');
      members = toTeamMembers(await invokeMatchingModel(userPrompt), employeesById, slots);
    }
    // …then drop whatever is still rationale-less to an unfilled slot.
    members = dropRationaleLessToUnfilled(members);

    return { members, emptyPool: false };
  } catch (err) {
    if (err instanceof TeamMatchingError) throw err;
    throw new TeamMatchingError(`Team matching failed: ${errorMessageOf(err)}`, err);
  }
};

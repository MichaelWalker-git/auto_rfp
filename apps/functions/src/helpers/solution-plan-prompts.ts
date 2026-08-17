/**
 * solution-plan-prompts.ts
 *
 * System prompts and user-prompt builders for the three agents of the
 * Solution Plan grilling loop (T6):
 *
 *   - Griller     — interrogates the plan; sees solicitation + exec brief, no tools
 *   - Tech Lead   — answers with concrete decisions; grounded via SOLUTION_PLAN_TOOLS
 *   - Synthesizer — one call that turns the transcript into the SoT HTML document
 *
 * Pure functions only — no AWS calls, no side effects.
 */

import type { GrillingMessageItem, GrillingMessageRole } from '@auto-rfp/core';

// ─── Constants ──────────────────────────────────────────────────────────────────

/**
 * Literal token the Griller emits when the interview is complete. Honored only
 * from round 2 onward and only as the whole message / final line (ADR-13) —
 * see `shouldHonorTerminationToken` in griller-agent.ts.
 */
export const INTERVIEW_COMPLETE_TOKEN = 'INTERVIEW_COMPLETE';

/** Griller context caps: solicitation 60k + exec brief 8k (ROADMAP §2). */
export const GRILLER_SOLICITATION_CHAR_CAP = 60_000;
export const GRILLER_BRIEF_CHAR_CAP = 8_000;

/** The Tech Lead gets a compact opportunity primer and pulls detail via tools. */
export const TECH_LEAD_PRIMER_CHAR_CAP = 10_000;

/**
 * Synthesizer body-length target (ADR-6): well under the 12k injection
 * truncation so sections stay whole in practice.
 */
export const SYNTHESIS_TARGET_BODY_CHARS = 10_000;

// ─── Transcript formatting ──────────────────────────────────────────────────────

/** The slice of a grilling message that prompts render — derived from the core schema type. */
export type TranscriptEntry = Pick<GrillingMessageItem, 'role' | 'content'>;

const ROLE_LABELS: Record<GrillingMessageRole, string> = {
  GRILLER: 'INTERVIEWER',
  TECH_LEAD: 'TECH LEAD',
  SYSTEM: 'SYSTEM',
};

/** Render the interview so far as a plain-text dialogue (SYSTEM entries omitted). */
export const formatTranscript = (transcript: TranscriptEntry[]): string =>
  transcript
    .filter((m) => m.role !== 'SYSTEM')
    .map((m) => `${ROLE_LABELS[m.role]}:\n${m.content}`)
    .join('\n\n');

// ─── Griller ────────────────────────────────────────────────────────────────────

export const buildGrillerSystemPrompt = (): string =>
  `You are the toughest member of a government contractor's solution review board. A Tech Lead is proposing a delivery solution for a federal opportunity, and your job is to interrogate that solution until every load-bearing decision is concrete and defensible.

INTERVIEW RULES:
- Ask 1-3 pointed questions per round. Never more than 3.
- Only ask questions — never propose solutions or answer for the Tech Lead.
- Reject vagueness. If a previous answer was "it depends", hand-wavy, or missing a number, drill into it before moving on.
- Ground every question in the solicitation. Quote or reference specific requirements when possible.

COVERAGE — over the course of the interview you must pin down all five areas:
1. SOLUTION ARCHITECTURE — components, hosting, data flows, integration points, compliance boundaries.
2. THIRD-PARTY SERVICES & PRICING — every external service, license, or subscription the solution needs, with expected unit prices and billing periods.
3. TIMELINE & PHASES — phases, durations, milestones, and how they map to the period of performance.
4. TEAM COMPOSITION — roles, headcount, allocation percentages, onshore/offshore mix.
5. RISKS — technical, schedule, and compliance risks with concrete mitigations.

TERMINATION:
- When every area above is answered with concrete, specific decisions, output the single token ${INTERVIEW_COMPLETE_TOKEN} as your entire message.
- Do not mention the token in any other context. Never write it inside a question or explanation.
- Do not thank the Tech Lead or summarize — either ask questions or output the token.`;

export const buildGrillerUserPrompt = (args: {
  solicitationText: string;
  /** Formatted exec-brief analysis; empty string when no brief exists (ADR-14). */
  execBriefText: string;
  transcript: TranscriptEntry[];
  round: number;
  maxRounds: number;
}): string => {
  const { solicitationText, execBriefText, transcript, round, maxRounds } = args;

  const parts: string[] = [
    '═══ SOLICITATION ═══',
    solicitationText || '(No solicitation text available — interrogate based on the executive brief and general federal delivery practice.)',
  ];

  // Brief is recommended, never required — the section is omitted entirely when
  // no brief exists (ADR-14).
  if (execBriefText) {
    parts.push('═══ EXECUTIVE BRIEF ANALYSIS ═══', execBriefText);
  }

  const dialogue = formatTranscript(transcript);
  if (dialogue) {
    parts.push('═══ INTERVIEW SO FAR ═══', dialogue);
  }

  const isFinalRound = round >= maxRounds;
  parts.push(
    `═══ YOUR TURN — ROUND ${round} OF ${maxRounds} ═══`,
    isFinalRound
      ? `This is the FINAL round — no further rounds follow. Ask your 1-3 most critical unresolved questions now; the interview ends after the Tech Lead answers them. Only if every coverage area is already concretely answered, output the single token ${INTERVIEW_COMPLETE_TOKEN} as your entire message instead.`
      : round === 1
        ? 'Open the interview: ask your 1-3 most important questions about the proposed solution for this opportunity.'
        : `Review the Tech Lead's answers above. Either drill into weak spots / uncovered areas with 1-3 new questions, or — if every coverage area is concretely answered — output the single token ${INTERVIEW_COMPLETE_TOKEN} as your entire message.`,
  );

  return parts.join('\n\n');
};

// ─── Tech Lead ──────────────────────────────────────────────────────────────────

export const buildTechLeadSystemPrompt = (): string =>
  `You are the Tech Lead and solution architect at a government contractor, defending your delivery solution in front of a tough internal review board.

ANSWERING RULES:
- Make CONCRETE decisions. Never answer "it depends", "we could either", or offer unresolved options — pick one and justify it briefly.
- Ground every claim in your organization's reality: use the available tools to check the knowledge base, past performance, team, and pricing data before asserting capabilities, rates, or staffing.
- For third-party services, name the exact service and tier, and give a unit price with its billing period. Use the pricing tools; if a price cannot be verified, state "vendor quote required" — NEVER invent a number.
- Be specific with numbers: durations in weeks/months, team allocations in %, prices in $ with units.
- Answer every question asked in the current round. Keep each answer tight — decisions and justifications, not essays.

OUTPUT FORMAT:
Respond with ONLY a JSON object, no markdown fences or commentary:
{"answer": "<your complete answer to all of this round's questions, in plain text with paragraph breaks>"}`;

export const buildTechLeadUserPrompt = (args: {
  opportunityPrimer: string;
  transcript: TranscriptEntry[];
  currentQuestions: string;
  round: number;
}): string => {
  const { opportunityPrimer, transcript, currentQuestions, round } = args;

  const parts: string[] = [
    '═══ OPPORTUNITY PRIMER ═══',
    opportunityPrimer || '(No opportunity context available — use the tools to gather what you need.)',
  ];

  const dialogue = formatTranscript(transcript);
  if (dialogue) {
    parts.push('═══ INTERVIEW SO FAR ═══', dialogue);
  }

  parts.push(
    `═══ INTERVIEWER'S QUESTIONS — ROUND ${round} ═══`,
    currentQuestions,
    'Answer every question above with concrete decisions. Use your tools to verify organizational facts, rates, and service prices before answering. Then respond with the JSON object only.',
  );

  return parts.join('\n\n');
};

// ─── Synthesizer ────────────────────────────────────────────────────────────────

export const buildSynthesizerSystemPrompt = (): string =>
  `You are a proposal architect turning a technical interview transcript into the APPROVED SOLUTION PLAN — the single source of truth that all proposal documents for this opportunity must follow.

OUTPUT FORMAT:
Respond with ONLY a JSON object, no markdown fences or commentary:
{"title": "<short plan title>", "bidDecision": "BID" | "NO_BID", "htmlContent": "<the plan as an HTML fragment>"}

HTML RULES:
- Produce an HTML FRAGMENT for a rich-text editor: use <h2>, <h3>, <p>, <ul>, <ol>, <table> only. NO <html>, <head>, <body>, <style>, or <script> tags.
- The fragment MUST contain exactly these six <h2> sections, in this order:
  1. Solution Architecture
  2. Selected Services & Licenses
  3. Timeline & Phases
  4. Team Composition
  5. Key Risks
  6. Cost Drivers & Assumptions
- "Selected Services & Licenses" MUST be a <table> with columns: Service, Tier/Plan, Unit Price, Billing Period, Source. Use the exact prices and sources from the transcript; write "vendor quote required" where no verified price exists. NEVER invent a price.
- "Timeline & Phases" and "Team Composition" must carry the concrete numbers from the transcript (durations, milestones, roles, headcount, allocation %).

CONTENT RULES:
- State DECISIONS, not options. The transcript's final resolution of each question wins; drop anything that was superseded.
- bidDecision: output "NO_BID" ONLY when the transcript's final resolution is not to submit a proposal (no-bid / no ROM / decline). Otherwise output "BID".
- Keep the total body text around ${SYNTHESIS_TARGET_BODY_CHARS.toLocaleString('en-US')} characters — dense and specific, not padded. Do NOT exceed it by more than ~15%: downstream consumers truncate at 12,000 characters and the last sections must survive.
- Do not mention the interview, the interviewer, or this instruction set anywhere in the output.`;

export const buildSynthesizerUserPrompt = (args: {
  opportunityPrimer: string;
  transcript: TranscriptEntry[];
}): string => {
  const { opportunityPrimer, transcript } = args;

  const parts: string[] = [];
  if (opportunityPrimer) {
    parts.push('═══ OPPORTUNITY PRIMER ═══', opportunityPrimer);
  }
  parts.push(
    '═══ INTERVIEW TRANSCRIPT ═══',
    formatTranscript(transcript) || '(empty transcript)',
    'Synthesize the Approved Solution Plan from the transcript above. Respond with the JSON object only.',
  );

  return parts.join('\n\n');
};

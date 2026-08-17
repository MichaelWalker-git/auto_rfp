/**
 * solution-plan-worker.ts
 *
 * Business logic for the Solution Plan grilling loop (T6). Step-per-round:
 * each SQS message drives exactly one grilling round (Griller turn → persist →
 * Tech Lead turn with tools → persist → enqueue next round or SYNTHESIZE), or
 * the final synthesis call that produces the SoT HTML and flips the plan to
 * READY.
 *
 * Safety rails:
 *  - zombie-round protection: no-op when `message.runId ≠ plan.runId` (ADR-5)
 *  - idempotent on SQS redelivery: a persisted turn is reused, not re-run, so
 *    a redelivered round resumes from wherever the previous attempt died
 *  - termination token honored only from round 2 and only as the whole
 *    message / final line (ADR-13); the final round always terminates
 *  - catch-all sets status FAILED + `error`, then rethrows for the DLQ
 */

import { z } from 'zod';

import type { SolutionPlanItem, SolutionPlanKey } from '@auto-rfp/core';

import { fetchExecutiveBriefAnalysis } from './db-tool-helpers';
import { loadSolicitation } from './document-generation';
import { errorMessageOf } from './error';
import { requireEnv } from './env';
import { nowIso } from './date';
import { invokeClaudeJson, truncateText } from './executive-opportunity-brief';
import { GrillerAgent, MIN_GRILLING_ROUNDS, shouldHonorTerminationToken } from './griller-agent';
import { TechLeadAgent } from './tech-lead-agent';
import {
  appendGrillingMessage,
  getSolutionPlanByOpportunity,
  listGrillingMessages,
  updateSolutionPlanStatus,
  uploadSolutionPlanHtml,
} from './solution-plan';
import { enqueueGrillingRound, type GrillingRoundMessage } from './solution-plan-queue';
import {
  GRILLER_BRIEF_CHAR_CAP,
  GRILLER_SOLICITATION_CHAR_CAP,
  TECH_LEAD_PRIMER_CHAR_CAP,
  buildSynthesizerSystemPrompt,
  buildSynthesizerUserPrompt,
  type TranscriptEntry,
} from './solution-plan-prompts';

export { MIN_GRILLING_ROUNDS };

// ─── Config ─────────────────────────────────────────────────────────────────────

export const MAX_GRILLING_ROUNDS_CAP = 8;
const DEFAULT_MAX_ROUNDS = 4;

const SYNTHESIS_MAX_TOKENS = 16000;
/** Cap stored failure messages so the DDB item stays small. */
const MAX_STORED_ERROR_CHARS = 1000;

/** Main (Tech Lead + Synthesizer) model; falls back to the shared Bedrock model. */
const resolveModelId = (): string =>
  process.env.SOLUTION_PLAN_MODEL_ID || requireEnv('BEDROCK_MODEL_ID');

/** Optional cheaper model (e.g. Haiku) for the no-tools Griller turns. */
const resolveGrillerModelId = (): string =>
  process.env.SOLUTION_PLAN_GRILLER_MODEL_ID || resolveModelId();

/**
 * Max grilling rounds from `SOLUTION_PLAN_MAX_ROUNDS` (default 4), clamped to
 * [2, 8] — minimum 2 per ADR-13, hard cap 8.
 */
export const resolveMaxRounds = (): number => {
  const raw = Number(process.env.SOLUTION_PLAN_MAX_ROUNDS ?? DEFAULT_MAX_ROUNDS);
  const rounds = Number.isFinite(raw) ? Math.trunc(raw) : DEFAULT_MAX_ROUNDS;
  return Math.min(Math.max(rounds, MIN_GRILLING_ROUNDS), MAX_GRILLING_ROUNDS_CAP);
};

/** The plan-key triple every queue message carries (Data Clump → one builder). */
const planKeyFromMessage = (message: GrillingRoundMessage): SolutionPlanKey => ({
  orgId: message.orgId,
  projectId: message.projectId,
  opportunityId: message.opportunityId,
});

/** The transcript-identity triple shared by every appended grilling message. */
const messageBase = (
  message: GrillingRoundMessage,
): Pick<GrillingRoundMessage, 'solutionPlanId' | 'runId' | 'round'> => ({
  solutionPlanId: message.solutionPlanId,
  runId: message.runId,
  round: message.round,
});

export { errorMessageOf };

// ─── Shared context loading ─────────────────────────────────────────────────────

interface RoundContext {
  solicitationText: string;
  execBriefText: string;
  /** The current run's transcript messages, in round/time order. */
  runMessages: Array<{ role: TranscriptEntry['role']; content: string; round: number }>;
}

/**
 * The Tech Lead / Synthesizer primer: exec-brief analysis (when one exists)
 * plus the head of the solicitation, capped at 10k — detail comes via tools.
 */
const buildOpportunityPrimer = (solicitationText: string, execBriefText: string): string => {
  const parts = [
    execBriefText,
    solicitationText && `SOLICITATION (excerpt):\n${solicitationText}`,
  ].filter(Boolean);
  return truncateText(parts.join('\n\n'), TECH_LEAD_PRIMER_CHAR_CAP);
};

const loadRoundContext = async (message: GrillingRoundMessage): Promise<RoundContext> => {
  const [solicitationRaw, execBriefRaw, allMessages] = await Promise.all([
    loadSolicitation(message.projectId, message.opportunityId),
    // Empty string when no brief exists — recommended, never required (ADR-14)
    fetchExecutiveBriefAnalysis(message.projectId, message.opportunityId),
    listGrillingMessages(message.solutionPlanId),
  ]);

  return {
    solicitationText: truncateText(solicitationRaw, GRILLER_SOLICITATION_CHAR_CAP),
    execBriefText: execBriefRaw ? truncateText(execBriefRaw, GRILLER_BRIEF_CHAR_CAP) : '',
    // Only the current run's messages — a wiped/superseded run's leftovers
    // must never leak into prompts (ADR-5)
    runMessages: allMessages
      .filter((m) => m.runId === message.runId)
      .map(({ role, content, round }) => ({ role, content, round })),
  };
};

// ─── Synthesis output ───────────────────────────────────────────────────────────

const SynthesisResponseSchema = z.object({
  title: z.string().min(1),
  htmlContent: z.string().min(1),
});

// ─── Failure handling ───────────────────────────────────────────────────────────

/** Best-effort: record the failure on the plan, then let the caller rethrow. */
const markPlanFailed = async (
  key: SolutionPlanKey,
  message: GrillingRoundMessage,
  err: unknown,
): Promise<void> => {
  const errorMessage = truncateText(errorMessageOf(err), MAX_STORED_ERROR_CHARS);
  try {
    await updateSolutionPlanStatus(key, 'FAILED', { error: errorMessage });
    await appendGrillingMessage({
      ...messageBase(message),
      role: 'SYSTEM',
      content: `${message.phase === 'SYNTHESIZE' ? 'Synthesis' : 'Grilling'} failed: ${errorMessage}`,
    });
  } catch (statusErr) {
    console.error(
      '[solution-plan-worker] failed to record FAILED status:',
      errorMessageOf(statusErr),
    );
  }
};

/**
 * Shared guard rails for both phases: load the plan, drop the message when the
 * plan is missing or belongs to another run (zombie, ADR-5), and on any
 * processing error record FAILED + rethrow toward the DLQ.
 */
const withGuardedPlan = async (
  message: GrillingRoundMessage,
  label: string,
  fn: (plan: SolutionPlanItem, key: SolutionPlanKey) => Promise<void>,
): Promise<void> => {
  const key = planKeyFromMessage(message);

  const plan = await getSolutionPlanByOpportunity(key);
  if (!plan) {
    console.warn(
      `[solution-plan-worker] no plan for opportunity ${message.opportunityId} — dropping ${label}`,
    );
    return;
  }
  if (plan.runId !== message.runId) {
    console.log(
      `[solution-plan-worker] zombie ${label} dropped: message run ${message.runId} ≠ plan run ${plan.runId} (ADR-5)`,
    );
    return;
  }

  try {
    await fn(plan, key);
  } catch (err) {
    await markPlanFailed(key, message, err);
    throw err;
  }
};

// ─── Grilling round ─────────────────────────────────────────────────────────────

/** Interview finished — mark the plan and hand off to synthesis. */
const completeInterview = async (
  key: SolutionPlanKey,
  message: GrillingRoundMessage,
): Promise<void> => {
  await appendGrillingMessage({
    ...messageBase(message),
    role: 'SYSTEM',
    content: `Interview complete after ${message.round} round(s). Synthesizing the solution plan…`,
  });
  await updateSolutionPlanStatus(key, 'GENERATING_SOT', {
    grillingRounds: message.round,
    grillingCompletedAt: nowIso(),
  });
  await enqueueGrillingRound({ ...message, phase: 'SYNTHESIZE' });
};

/**
 * Process ONE grilling round: Griller turn → persist → (unless terminated)
 * Tech Lead turn with tools → persist → enqueue next round or SYNTHESIZE.
 *
 * Redelivery resumes instead of re-running: a turn already persisted for this
 * round + run is reused, so a crash anywhere in the round (even between the
 * last persist and the enqueue) never strands the plan in GRILLING.
 */
export const processGrillingRound = async (message: GrillingRoundMessage): Promise<void> =>
  withGuardedPlan(message, `round ${message.round}`, async (plan, key) => {
    if (plan.status === 'GENERATING_SOT') {
      // The interview already completed for this run but the SYNTHESIZE message
      // may have been lost mid-crash — re-drive the handoff (synthesis itself
      // skips when the plan is already READY).
      console.log(
        `[solution-plan-worker] plan already GENERATING_SOT for run ${message.runId} — re-enqueueing SYNTHESIZE`,
      );
      await enqueueGrillingRound({ ...message, phase: 'SYNTHESIZE' });
      return;
    }
    if (plan.status !== 'GRILLING') {
      console.log(
        `[solution-plan-worker] plan status is ${plan.status}, not GRILLING — dropping round ${message.round}`,
      );
      return;
    }

    const { solicitationText, execBriefText, runMessages } = await loadRoundContext(message);
    // Prior rounds only — the current round's own messages (present when a
    // redelivery resumes a half-completed round) travel separately below.
    const transcript: TranscriptEntry[] = runMessages
      .filter((m) => m.round < message.round)
      .map(({ role, content }) => ({ role, content }));
    const roundMessages = runMessages.filter((m) => m.round === message.round);

    const maxRounds = resolveMaxRounds();

    // ── Griller turn (reused on redelivery) ──
    const persistedGriller = roundMessages.find((m) => m.role === 'GRILLER');
    let grillerText: string;
    if (persistedGriller) {
      console.log(
        `[solution-plan-worker] round ${message.round} Griller turn already persisted for run ${message.runId} — resuming redelivery`,
      );
      grillerText = persistedGriller.content;
    } else {
      const griller = new GrillerAgent({ modelId: resolveGrillerModelId() });
      grillerText = await griller.ask({
        solicitationText,
        execBriefText,
        transcript,
        round: message.round,
        maxRounds,
      });
      await appendGrillingMessage({ ...messageBase(message), role: 'GRILLER', content: grillerText });
    }

    if (shouldHonorTerminationToken(grillerText, message.round)) {
      await completeInterview(key, message);
      return;
    }

    // ── Tech Lead turn (reused on redelivery) ──
    if (!roundMessages.some((m) => m.role === 'TECH_LEAD')) {
      const techLead = new TechLeadAgent({ modelId: resolveModelId() });
      const { answer, toolCalls } = await techLead.answer({
        opportunityPrimer: buildOpportunityPrimer(solicitationText, execBriefText),
        transcript,
        currentQuestions: grillerText,
        round: message.round,
        toolContext: { ...key, solutionPlanId: message.solutionPlanId },
      });
      await appendGrillingMessage({
        ...messageBase(message),
        role: 'TECH_LEAD',
        content: answer,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      });

      await updateSolutionPlanStatus(key, 'GRILLING', { grillingRounds: message.round });
    }

    // Final round always terminates (ADR-13) — even without the token, the
    // Tech Lead's last answers are in the transcript and synthesis proceeds.
    if (message.round >= maxRounds) {
      await completeInterview(key, message);
      return;
    }

    await enqueueGrillingRound({ ...message, round: message.round + 1, phase: 'GRILL' });
  });

// ─── Synthesis ──────────────────────────────────────────────────────────────────

/**
 * One call over the full transcript producing `{title, htmlContent}`, uploaded
 * to a fresh S3 version → plan READY. Version stays monotonic across
 * regenerations (ADR-11); a regenerate wipes user edits (ADR-4).
 */
export const processSynthesis = async (message: GrillingRoundMessage): Promise<void> =>
  withGuardedPlan(message, 'synthesis', async (plan, key) => {
    if (plan.status === 'READY') {
      console.log(
        '[solution-plan-worker] plan already READY for this run — skipping synthesis redelivery',
      );
      return;
    }

    const { solicitationText, execBriefText, runMessages } = await loadRoundContext(message);
    const transcript: TranscriptEntry[] = runMessages.map(({ role, content }) => ({ role, content }));
    if (!transcript.some((m) => m.role === 'TECH_LEAD')) {
      throw new Error('No Tech Lead answers in transcript — nothing to synthesize');
    }

    const { title, htmlContent } = await invokeClaudeJson({
      modelId: resolveModelId(),
      system: buildSynthesizerSystemPrompt(),
      user: buildSynthesizerUserPrompt({
        opportunityPrimer: buildOpportunityPrimer(solicitationText, execBriefText),
        transcript,
      }),
      outputSchema: SynthesisResponseSchema,
      maxTokens: SYNTHESIS_MAX_TOKENS,
      temperature: 0.3,
    });

    // Monotonic version (ADR-11) — bump from the plan's current counter, never reset
    const version = (plan.version ?? 0) + 1;
    const html = /<h1[\s>]/i.test(htmlContent) ? htmlContent : `<h1>${title}</h1>\n${htmlContent}`;
    const contentKey = await uploadSolutionPlanHtml(key, version, html);

    await updateSolutionPlanStatus(key, 'READY', {
      contentKey,
      version,
      // A fresh synthesis is current by definition and carries no user edits
      isStale: false,
      staleReason: '',
      isUserEdited: false,
      error: '',
    });
    await appendGrillingMessage({
      ...messageBase(message),
      role: 'SYSTEM',
      content: `Solution plan v${version} synthesized: "${title}"`,
    });

    console.log(
      `[solution-plan-worker] plan ${message.solutionPlanId} READY — v${version}, ${html.length} chars`,
    );
  });

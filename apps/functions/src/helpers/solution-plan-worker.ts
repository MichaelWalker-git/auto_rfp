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
 *  - idempotent on SQS redelivery: skip when the round's GRILLER message exists
 *  - termination token honored only from round 2 and only as the whole
 *    message / final line (ADR-13); the final round always terminates
 *  - catch-all sets status FAILED + `error`, then rethrows for the DLQ
 */

import { z } from 'zod';

import type { SolutionPlanKey } from '@auto-rfp/core';

import { fetchExecutiveBriefAnalysis } from './db-tool-helpers';
import { loadSolicitation } from './document-generation';
import { requireEnv } from './env';
import { nowIso } from './date';
import { invokeClaudeJson, truncateText } from './executive-opportunity-brief';
import { GrillerAgent, MIN_GRILLING_ROUNDS } from './griller-agent';
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

const errorMessageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

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
      solutionPlanId: message.solutionPlanId,
      runId: message.runId,
      round: message.round,
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

// ─── Grilling round ─────────────────────────────────────────────────────────────

/** Interview finished — mark the plan and hand off to synthesis. */
const completeInterview = async (
  key: SolutionPlanKey,
  message: GrillingRoundMessage,
): Promise<void> => {
  await appendGrillingMessage({
    solutionPlanId: message.solutionPlanId,
    runId: message.runId,
    round: message.round,
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
 */
export const processGrillingRound = async (message: GrillingRoundMessage): Promise<void> => {
  const key = planKeyFromMessage(message);

  const plan = await getSolutionPlanByOpportunity(key);
  if (!plan) {
    console.warn(`[solution-plan-worker] no plan for opportunity ${message.opportunityId} — dropping round`);
    return;
  }
  if (plan.runId !== message.runId) {
    console.log(
      `[solution-plan-worker] zombie round dropped: message run ${message.runId} ≠ plan run ${plan.runId} (ADR-5)`,
    );
    return;
  }
  if (plan.status !== 'GRILLING') {
    console.log(`[solution-plan-worker] plan status is ${plan.status}, not GRILLING — dropping round ${message.round}`);
    return;
  }

  try {
    const { solicitationText, execBriefText, runMessages } = await loadRoundContext(message);
    const transcript: TranscriptEntry[] = runMessages.map(({ role, content }) => ({ role, content }));

    // Idempotency on SQS redelivery: this round already ran for this run
    const alreadyGrilled = runMessages.some(
      (m) => m.round === message.round && m.role === 'GRILLER',
    );
    if (alreadyGrilled) {
      console.log(`[solution-plan-worker] round ${message.round} already processed for run ${message.runId} — skipping redelivery`);
      return;
    }

    const maxRounds = resolveMaxRounds();

    // ── Griller turn ──
    const griller = new GrillerAgent({ modelId: resolveGrillerModelId() });
    const grillerText = await griller.ask({
      solicitationText,
      execBriefText,
      transcript,
      round: message.round,
      maxRounds,
    });
    await appendGrillingMessage({
      solutionPlanId: message.solutionPlanId,
      runId: message.runId,
      round: message.round,
      role: 'GRILLER',
      content: grillerText,
    });

    if (griller.isInterviewComplete(grillerText, message.round)) {
      await completeInterview(key, message);
      return;
    }

    // ── Tech Lead turn ──
    const techLead = new TechLeadAgent({ modelId: resolveModelId() });
    const { answer, toolCalls } = await techLead.answer({
      opportunityPrimer: buildOpportunityPrimer(solicitationText, execBriefText),
      transcript,
      currentQuestions: grillerText,
      round: message.round,
      toolContext: { ...key, solutionPlanId: message.solutionPlanId },
    });
    await appendGrillingMessage({
      solutionPlanId: message.solutionPlanId,
      runId: message.runId,
      round: message.round,
      role: 'TECH_LEAD',
      content: answer,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    });

    await updateSolutionPlanStatus(key, 'GRILLING', { grillingRounds: message.round });

    // Final round always terminates (ADR-13) — even without the token, the
    // Tech Lead's last answers are in the transcript and synthesis proceeds.
    if (message.round >= maxRounds) {
      await completeInterview(key, message);
      return;
    }

    await enqueueGrillingRound({ ...message, round: message.round + 1, phase: 'GRILL' });
  } catch (err) {
    await markPlanFailed(key, message, err);
    throw err;
  }
};

// ─── Synthesis ──────────────────────────────────────────────────────────────────

/**
 * One call over the full transcript producing `{title, htmlContent}`, uploaded
 * to a fresh S3 version → plan READY. Version stays monotonic across
 * regenerations (ADR-11); a regenerate wipes user edits (ADR-4).
 */
export const processSynthesis = async (message: GrillingRoundMessage): Promise<void> => {
  const key = planKeyFromMessage(message);

  const plan = await getSolutionPlanByOpportunity(key);
  if (!plan) {
    console.warn(`[solution-plan-worker] no plan for opportunity ${message.opportunityId} — dropping synthesis`);
    return;
  }
  if (plan.runId !== message.runId) {
    console.log(
      `[solution-plan-worker] zombie synthesis dropped: message run ${message.runId} ≠ plan run ${plan.runId} (ADR-5)`,
    );
    return;
  }
  if (plan.status === 'READY') {
    console.log('[solution-plan-worker] plan already READY for this run — skipping synthesis redelivery');
    return;
  }

  try {
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
      solutionPlanId: message.solutionPlanId,
      runId: message.runId,
      round: message.round,
      role: 'SYSTEM',
      content: `Solution plan v${version} synthesized: "${title}"`,
    });

    console.log(
      `[solution-plan-worker] plan ${message.solutionPlanId} READY — v${version}, ${html.length} chars`,
    );
  } catch (err) {
    await markPlanFailed(key, message, err);
    throw err;
  }
};

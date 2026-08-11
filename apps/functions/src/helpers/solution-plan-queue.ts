/**
 * solution-plan-queue.ts
 *
 * SQS enqueue helper for the Solution Plan grilling loop (T6). The loop is
 * step-per-round: each message drives exactly ONE round (or the final
 * synthesis), keeping every Lambda run well under its timeout.
 */

import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { z } from 'zod';
import { requireEnv } from './env';

const sqs = new SQSClient({});
const SOLUTION_PLAN_QUEUE_URL = requireEnv('SOLUTION_PLAN_QUEUE_URL');

// ─── Message schema ─────────────────────────────────────────────────────────────

export const GrillingPhaseSchema = z.enum(['GRILL', 'SYNTHESIZE']);
export type GrillingPhase = z.infer<typeof GrillingPhaseSchema>;

/**
 * One step of the grilling run. `runId` travels on every message so a worker
 * can no-op zombie rounds from a superseded run (ADR-5).
 */
export const GrillingRoundMessageSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  solutionPlanId: z.string().min(1),
  runId: z.string().min(1),
  /** 1-based round number; for SYNTHESIZE, the last completed grilling round. */
  round: z.number().int().min(1),
  phase: GrillingPhaseSchema,
});

export type GrillingRoundMessage = z.infer<typeof GrillingRoundMessageSchema>;

// ─── Enqueue ────────────────────────────────────────────────────────────────────

export const enqueueGrillingRound = async (message: GrillingRoundMessage): Promise<void> => {
  console.log(
    `[solution-plan-queue] enqueue ${message.phase} round=${message.round} plan=${message.solutionPlanId} run=${message.runId}`,
  );

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: SOLUTION_PLAN_QUEUE_URL,
      MessageBody: JSON.stringify(message),
    }),
  );
};

/**
 * solution-plan.ts
 *
 * DB + S3 helpers for the Solution Plan ("Source of Truth") entity and its
 * grilling interview transcript. One plan per opportunity; the synthesized
 * HTML body lives in S3 (versioned key), DynamoDB holds only metadata.
 *
 * All DynamoDB access goes through `@/helpers/db` — handlers and workers call
 * these helpers, never the SDK directly.
 */

import { v4 as uuidv4 } from 'uuid';

import type {
  GrillingMessageDBItem,
  GrillingMessageItem,
  GrillingMessageRole,
  GrillingToolCallSummary,
  SolutionPlanDBItem,
  SolutionPlanItem,
  SolutionPlanKey,
  SolutionPlanStatus,
  SolutionPlanStatusPatch,
} from '@auto-rfp/core';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { GRILLING_MESSAGE_PK, SOLUTION_PLAN_PK } from '@/constants/solution-plan';
import { batchDeleteItems, getItem, putItem, queryAllBySkPrefix, updateItem } from './db';
import { loadTextFromS3, uploadToS3 } from './s3';
import { requireEnv } from './env';
import { nowIso } from './date';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

// ─── Sort key builders ──────────────────────────────────────────────────────────

/**
 * Plan SK: `{orgId}#{projectId}#{opportunityId}` — deterministic, so exactly
 * one plan exists per opportunity (init upserts the same key).
 */
export const buildSolutionPlanSk = (key: SolutionPlanKey): string =>
  `${key.orgId}#${key.projectId}#${key.opportunityId}`;

/** Zero-pad a round number so message SKs sort lexicographically (1 → "001"). */
export const padGrillingRound = (round: number): string => String(round).padStart(3, '0');

/**
 * Message SK: `{solutionPlanId}#{round:3pad}#{ts}#{messageId}` — a prefix query
 * on the plan id returns the transcript in round/time order.
 *
 * Deliberately NOT org-prefixed: the plan id is a uuid minted server-side for
 * an org-scoped plan, so tenancy is enforced at the plan record and the id is
 * unguessable — and the worker/transcript reads only ever key by plan id.
 */
export const buildGrillingMessageSk = (
  solutionPlanId: string,
  round: number,
  ts: string,
  messageId: string,
): string => `${solutionPlanId}#${padGrillingRound(round)}#${ts}#${messageId}`;

/** SK prefix for querying all transcript messages of a plan. */
export const buildGrillingMessageSkPrefix = (solutionPlanId: string): string =>
  `${solutionPlanId}#`;

// ─── Plan CRUD ──────────────────────────────────────────────────────────────────

export const getSolutionPlanByOpportunity = async (
  key: SolutionPlanKey,
): Promise<SolutionPlanDBItem | null> =>
  getItem<SolutionPlanDBItem>(SOLUTION_PLAN_PK, buildSolutionPlanSk(key));

/**
 * Upsert the full plan record (init/re-init path). The SK is derived from the
 * plan's own identifiers; passing an existing `createdAt` preserves it.
 */
export const putSolutionPlan = async (plan: SolutionPlanItem): Promise<SolutionPlanDBItem> =>
  putItem<SolutionPlanDBItem>(SOLUTION_PLAN_PK, buildSolutionPlanSk(plan), plan);

/**
 * Transition the plan's lifecycle status, optionally patching related fields
 * (e.g. `contentKey` + `version` on READY, `error` on FAILED).
 * Throws if the plan does not exist.
 */
export const updateSolutionPlanStatus = async (
  key: SolutionPlanKey,
  status: SolutionPlanStatus,
  patch?: SolutionPlanStatusPatch,
): Promise<SolutionPlanDBItem> =>
  updateItem<SolutionPlanDBItem>(SOLUTION_PLAN_PK, buildSolutionPlanSk(key), {
    status,
    ...patch,
  });

/** Strip the single-table keys off a DB record → the pure domain item. */
export const toSolutionPlanItem = (dbItem: SolutionPlanDBItem): SolutionPlanItem => {
  const { [PK_NAME]: _pk, [SK_NAME]: _sk, ...item } = dbItem;
  return item;
};

/**
 * Persist a user edit of a READY plan's content (ADR-8): bump version +
 * contentKey, set `isUserEdited`/`editedBy`, clear staleness. Both checks are
 * DynamoDB conditions, so the write is atomic against races:
 *  - status must still be READY — a concurrent re-init can't be clobbered
 *  - version must still be `patch.version - 1` — two concurrent edits can't
 *    both claim v{N+1} and silently drop one (ADR-11: versions never collide)
 * Returns null when either condition fails (or the plan is missing).
 */
export const updateSolutionPlanContent = async (
  key: SolutionPlanKey,
  patch: { version: number; contentKey: string; editedBy?: string },
): Promise<SolutionPlanDBItem | null> => {
  try {
    return await updateItem<SolutionPlanDBItem>(
      SOLUTION_PLAN_PK,
      buildSolutionPlanSk(key),
      { ...patch, isUserEdited: true, isStale: false, staleReason: '' },
      {
        condition:
          'attribute_exists(#pk) AND #status = :readyStatus AND #version = :expectedVersion',
        conditionNames: { '#pk': PK_NAME, '#status': 'status', '#version': 'version' },
        conditionValues: {
          ':readyStatus': 'READY' satisfies SolutionPlanStatus,
          ':expectedVersion': patch.version - 1,
        },
      },
    );
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      console.log(
        `[updateSolutionPlanContent] refused — plan missing or not READY (opportunityId=${key.opportunityId})`,
      );
      return null;
    }
    throw err;
  }
};

/**
 * Mark a READY plan stale (ADR-3). No-op unless the plan exists AND its status
 * is READY — a plan mid-grilling or FAILED is never marked stale. The check is
 * a DynamoDB condition, so the read-check-write is atomic.
 *
 * Returns the updated plan, or null when the guard made it a no-op.
 */
export const markSolutionPlanStale = async (
  key: SolutionPlanKey,
  reason: string,
): Promise<SolutionPlanDBItem | null> => {
  try {
    return await updateItem<SolutionPlanDBItem>(
      SOLUTION_PLAN_PK,
      buildSolutionPlanSk(key),
      { isStale: true, staleReason: reason },
      {
        condition: 'attribute_exists(#pk) AND #status = :readyStatus',
        conditionNames: { '#pk': PK_NAME, '#status': 'status' },
        conditionValues: { ':readyStatus': 'READY' satisfies SolutionPlanStatus },
      },
    );
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      console.log(
        `[markSolutionPlanStale] no-op — plan missing or not READY (opportunityId=${key.opportunityId})`,
      );
      return null;
    }
    throw err;
  }
};

// ─── Grilling transcript ────────────────────────────────────────────────────────

export const appendGrillingMessage = async (args: {
  solutionPlanId: string;
  runId: string;
  round: number;
  role: GrillingMessageRole;
  content: string;
  toolCalls?: GrillingToolCallSummary[];
}): Promise<GrillingMessageDBItem> => {
  const messageId = uuidv4();
  const ts = nowIso();

  // putItem (not createItem) so `createdAt` can be pinned to the exact `ts`
  // embedded in the SK — the SK timestamp segment stays reconstructable from
  // the stored item. Collisions are impossible: the SK ends in a fresh uuid.
  return putItem<GrillingMessageDBItem>(
    GRILLING_MESSAGE_PK,
    buildGrillingMessageSk(args.solutionPlanId, args.round, ts, messageId),
    {
      id: messageId,
      solutionPlanId: args.solutionPlanId,
      runId: args.runId,
      round: args.round,
      role: args.role,
      content: args.content,
      toolCalls: args.toolCalls,
      createdAt: ts,
    },
  );
};

/** Full transcript for a plan, in round/time order (paginates internally). */
export const listGrillingMessages = async (
  solutionPlanId: string,
): Promise<GrillingMessageDBItem[]> =>
  queryAllBySkPrefix<GrillingMessageDBItem>(
    GRILLING_MESSAGE_PK,
    buildGrillingMessageSkPrefix(solutionPlanId),
  );

/** Strip the single-table keys off a transcript record → the pure domain item. */
export const toGrillingMessageItem = (dbItem: GrillingMessageDBItem): GrillingMessageItem => {
  const { [PK_NAME]: _pk, [SK_NAME]: _sk, ...item } = dbItem;
  return item;
};

/**
 * Wipe the full transcript of a plan (wipe-on-regenerate, ADR-2). Any message
 * a zombie worker appends afterwards carries a superseded runId and is
 * filtered out of every read (ADR-5). Returns the number of deleted messages.
 */
export const deleteGrillingMessages = async (solutionPlanId: string): Promise<number> => {
  const messages = await listGrillingMessages(solutionPlanId);
  if (!messages.length) return 0;

  const { deleted, failed } = await batchDeleteItems(
    messages.map((m) => ({ pk: GRILLING_MESSAGE_PK, sk: m[SK_NAME] })),
  );
  if (failed > 0) {
    // Leftovers are invisible to reads (superseded runId) — log, don't fail the init
    console.warn(`[deleteGrillingMessages] ${failed} message(s) failed to delete for plan ${solutionPlanId}`);
  }
  return deleted;
};

// ─── S3 HTML content ────────────────────────────────────────────────────────────

/**
 * Versioned S3 key for the synthesized plan body. Old versions are kept —
 * generated documents reference the exact version they were built from (ADR-7).
 */
export const buildSolutionPlanHtmlKey = (key: SolutionPlanKey, version: number): string =>
  `${key.orgId}/${key.projectId}/${key.opportunityId}/solution-plan/v${version}/solution-plan.html`;

/** Upload one version of the plan HTML to S3 and return its key. */
export const uploadSolutionPlanHtml = async (
  key: SolutionPlanKey,
  version: number,
  html: string,
): Promise<string> => {
  const s3Key = buildSolutionPlanHtmlKey(key, version);
  // Buffer body ensures correct encoding — string Body can land empty in S3
  await uploadToS3(DOCUMENTS_BUCKET, s3Key, Buffer.from(html, 'utf-8'), 'text/html; charset=utf-8');
  return s3Key;
};

/** Load the plan HTML for a stored `contentKey`. */
export const loadSolutionPlanHtml = async (contentKey: string): Promise<string> =>
  loadTextFromS3(DOCUMENTS_BUCKET, contentKey);

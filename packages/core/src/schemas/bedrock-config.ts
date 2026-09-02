/**
 * bedrock-config.ts
 *
 * Per-org Bedrock configuration — the NON-SECRET half of a bring-your-own
 * Bedrock key. The Bedrock Bearer API key itself is NEVER stored here; it lives
 * in AWS Secrets Manager under `bedrock-api-key-<orgId>`. This entity holds only
 * the queryable config: the optional per-org text fallback model ID and the
 * result of the last save-time probe.
 *
 * DynamoDB: PK `BEDROCK_CONFIG`, SK `{orgId}` (one config per org).
 *
 * Follows the mandatory 5-type entity pattern:
 *   CreateRequest → UpdateRequest → Item → DBItem → ListItem.
 */
import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants';

// ─── Probe result sub-schemas ──────────────────────────────────────────────

/** The role a probed model plays in the app. */
export const BedrockModelRoleSchema = z.enum([
  'embeddings',
  'default',
  'chat',
  'worker',
  'fallback',
]);
export type BedrockModelRole = z.infer<typeof BedrockModelRoleSchema>;

/** Outcome of probing a single model with the submitted key. */
export const BedrockProbeModelResultSchema = z.object({
  modelId: z.string().min(1),
  role: BedrockModelRoleSchema,
  ok: z.boolean(),
  /** Present only when `ok` is false — short reason (e.g. ResourceNotFoundException). */
  error: z.string().optional(),
});
export type BedrockProbeModelResult = z.infer<typeof BedrockProbeModelResultSchema>;

/** Result of the last save-time probe (per-model outcome + timestamp). */
export const BedrockProbeResultSchema = z.object({
  probedAt: z.string().min(1),
  accepted: z.boolean(),
  results: z.array(BedrockProbeModelResultSchema),
});
export type BedrockProbeResult = z.infer<typeof BedrockProbeResultSchema>;

// ─── 1. Create request — non-secret fields only, server-managed fields omitted ─

export const BedrockConfigCreateRequestSchema = z.object({
  orgId: z.string().min(1),
  /** Optional single free-text fallback model ID for text roles only. */
  fallbackModelId: z.string().min(1).optional(),
});
export type BedrockConfigCreateRequest = z.infer<typeof BedrockConfigCreateRequestSchema>;

// ─── 2. Update request — partial, identifiers not patchable ────────────────

export const BedrockConfigUpdateRequestSchema =
  BedrockConfigCreateRequestSchema.partial().omit({ orgId: true });
export type BedrockConfigUpdateRequest = z.infer<typeof BedrockConfigUpdateRequestSchema>;

// ─── 3. Item — pure domain entity (NO db keys, NO api key) ─────────────────

export const BedrockConfigItemSchema = BedrockConfigCreateRequestSchema.extend({
  id: z.string().min(1),
  lastProbe: BedrockProbeResultSchema.optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  createdBy: z.string().optional(),
});
export type BedrockConfigItem = z.infer<typeof BedrockConfigItemSchema>;

// ─── 4. DBItem — Item + single-table keys ──────────────────────────────────

export const BedrockConfigDBItemSchema = BedrockConfigItemSchema.extend({
  [PK_NAME]: z.string(), // BEDROCK_CONFIG
  [SK_NAME]: z.string(), // `${orgId}`
});
export type BedrockConfigDBItem = z.infer<typeof BedrockConfigDBItemSchema>;

// ─── 5. ListItem — lightweight projection ──────────────────────────────────

export const BedrockConfigListItemSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  fallbackModelId: z.string().optional(),
  lastProbe: BedrockProbeResultSchema.optional(),
  updatedAt: z.string().optional(),
});
export type BedrockConfigListItem = z.infer<typeof BedrockConfigListItemSchema>;

// ─── Transport DTOs (NOT persisted as the entity) ──────────────────────────
//
// These two schemas are the API boundary shapes. They are intentionally
// separate from the 5-type entity above: the save request carries the Bearer
// key in-flight ONLY (it is written to Secrets Manager, never to the entity),
// and the status response is what GET returns — it NEVER echoes the key back.

/**
 * POST body for saving/clearing a per-org Bedrock config.
 * An empty `apiKey` (`''`) means "clear" — delete the secret + config.
 */
export const BedrockConfigSaveRequestSchema = z.object({
  orgId: z.string().min(1),
  apiKey: z.string(),
  fallbackModelId: z.string().min(1).optional(),
});
export type BedrockConfigSaveRequest = z.infer<typeof BedrockConfigSaveRequestSchema>;

/** GET response — configuration STATUS only. Never contains the key. */
export const BedrockConfigStatusResponseSchema = z.object({
  configured: z.boolean(),
  fallbackModelId: z.string().optional(),
  lastProbe: BedrockProbeResultSchema.optional(),
});
export type BedrockConfigStatusResponse = z.infer<typeof BedrockConfigStatusResponseSchema>;

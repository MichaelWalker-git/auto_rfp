/**
 * bedrock-probe.ts
 *
 * Save-time probe + acceptance rule for a per-org Bedrock key (ticket 04).
 *
 * When an admin submits a Bedrock Bearer key, we probe it — with the
 * just-submitted key, BEFORE storing anything — against every model the app
 * needs, then apply the ADR-004 acceptance rule:
 *
 *   - titan-embed MUST be invokable, else REJECT (embeddings have no fallback).
 *   - if ALL text models (default/chat/worker) are invokable → ACCEPT.
 *   - if ANY text model is missing → a fallback MUST be supplied AND itself
 *     probe-invokable, else REJECT with the exact list of missing text models.
 *
 * Availability is NOT persisted as a routing map — the probe is for at-save
 * feedback + the accept/reject gate only. Invoke-time retry (ticket 09) does
 * runtime model selection independently.
 */
import { probeModel } from './bedrock-http-client';
import { requireEnv } from './env';
import type {
  BedrockModelRole,
  BedrockProbeModelResult,
  BedrockProbeResult,
} from '@auto-rfp/core';

/** The four globally-pinned models the app requires (ADR-003). */
const getRequiredModels = (): { modelId: string; role: BedrockModelRole }[] => [
  { modelId: requireEnv('BEDROCK_EMBEDDING_MODEL_ID'), role: 'embeddings' },
  { modelId: requireEnv('BEDROCK_MODEL_ID'), role: 'default' },
  { modelId: requireEnv('BEDROCK_CHAT_MODEL_ID'), role: 'chat' },
  { modelId: requireEnv('BEDROCK_WORKER_MODEL_ID'), role: 'worker' },
];

const TEXT_ROLES: BedrockModelRole[] = ['default', 'chat', 'worker'];

export interface ProbeAcceptance {
  /** Full per-model outcome + timestamp — persisted as `lastProbe` on accept. */
  probe: BedrockProbeResult;
  /** Whether the key satisfies the acceptance rule. */
  accepted: boolean;
  /**
   * On reject, the exact model IDs that caused it (titan and/or the text models
   * with no working fallback). Empty on accept.
   */
  missing: string[];
}

/**
 * Probe the submitted key against all required models (+ the optional fallback)
 * concurrently and apply the ADR-004 acceptance rule. Never throws on a
 * model-level failure — an inaccessible model is a normal, reportable result.
 */
export const probeBedrockKey = async (args: {
  apiKey: string;
  fallbackModelId?: string;
}): Promise<ProbeAcceptance> => {
  const { apiKey, fallbackModelId } = args;

  const required = getRequiredModels();
  const targets: { modelId: string; role: BedrockModelRole }[] = [...required];
  if (fallbackModelId) {
    targets.push({ modelId: fallbackModelId, role: 'fallback' });
  }

  const results: BedrockProbeModelResult[] = await Promise.all(
    targets.map(async ({ modelId, role }) => {
      const { ok, error } = await probeModel(modelId, apiKey);
      return { modelId, role, ok, ...(error ? { error } : {}) };
    }),
  );

  const titan = results.find((r) => r.role === 'embeddings');
  const missingText = results.filter((r) => TEXT_ROLES.includes(r.role) && !r.ok);
  const fallback = results.find((r) => r.role === 'fallback');

  let accepted: boolean;
  let missing: string[];

  if (!titan?.ok) {
    // Embeddings are hard-required and have no fallback path.
    accepted = false;
    missing = results.filter((r) => !r.ok && r.role !== 'fallback').map((r) => r.modelId);
  } else if (missingText.length === 0) {
    accepted = true;
    missing = [];
  } else if (fallbackModelId && fallback?.ok) {
    // Every missing text role can be served by the working fallback.
    accepted = true;
    missing = [];
  } else {
    accepted = false;
    missing = missingText.map((r) => r.modelId);
  }

  return {
    probe: { probedAt: new Date().toISOString(), accepted, results },
    accepted,
    missing,
  };
};

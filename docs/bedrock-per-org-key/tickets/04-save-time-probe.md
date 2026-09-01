# 04 — Save-time probe + acceptance rule

**What to build:** When an admin saves a Bedrock key, the system immediately probes it against
every model the app needs and gives specific feedback: either "configured successfully" or the
exact list of required models the key can't invoke — and the save is **rejected** until the key is
viable. This turns a silent mid-generation failure into an at-save error.

**Blocked by:** 02 — backend set/get handlers; 03 — frontend Bedrock card.

**Status:** ready-for-agent

- [x] The set handler runs a tiny test invoke against each required model (titan-embed +
      opus/haiku/sonnet) plus the fallback if supplied, **using the just-submitted key** (not a
      stored/resolved one). Probes run concurrently and stay well under the API Gateway 30s cap.
- [x] A `probeModel(modelId, apiKey)` primitive exists (invoke with an explicit key, independent of
      per-org resolution) so the probe works before any key is stored.
- [x] Acceptance rule (authoritative, from ADR-004): titan-embed must be invokable else **reject**;
      if all text models are invokable → **accept** (no fallback needed); if any text model is
      missing → a fallback **must** be supplied and itself probe-invokable, else **reject with the
      exact list of missing models**.
- [x] On accept, the secret + config are written and `lastProbe` is persisted; on reject, nothing is
      stored and a 4xx returns the missing-model list. The fallback field is re-validated on every
      save.
- [x] The card surfaces the rejection reason (which required models the key can't run) and the
      success confirmation. (front-end — ticket 03: probe-rejection alert + missing-model list)
- [x] Handler tests cover the acceptance rule exhaustively: titan missing → reject; all text present
      → accept; text missing + working fallback → accept; text missing + no/failing fallback →
      reject with the exact missing-model list; probe uses the submitted key; secret+config written
      only on accept.

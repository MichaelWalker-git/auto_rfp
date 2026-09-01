# 01 — Bedrock config core schema

**What to build:** The non-secret half of a per-org Bedrock configuration — fallback model ID,
last-probe result, and timestamps — as a first-class domain entity that every later ticket reads
and writes. On its own this delivers a validated, buildable schema that the backend and frontend
can both import; no runtime behavior changes yet.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A `BedrockConfig` entity is defined in `packages/core` following the mandatory 5-type pattern
      (`CreateRequest`, `UpdateRequest`, `Item`, `DBItem`, `ListItem`), all types inferred from Zod.
- [ ] The config carries the non-secret fields only: `orgId`, optional `fallbackModelId`, and a
      `lastProbe` result (per-model outcome + timestamp) — **never** the API key.
- [ ] `Item` has no `partition_key`/`sort_key`; `DBItem` extends `Item` with the computed
      `[PK_NAME]`/`[SK_NAME]` keys and lives in core.
- [ ] Exported from the core schema barrel and `packages/core` builds.
- [ ] Vitest tests: valid data passes, invalid fails, optional fields omit cleanly, `Item` has no
      DB keys, `DBItem` carries the computed keys.

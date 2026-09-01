# ADR-007 — Per-org key caching and rotation

**Status:** Accepted (2026-08-31)

## Context

Today the client caches one process-wide `cachedApiKey` string for warm-container reuse. Per-org, that
becomes per-org caching. A warm Lambda container holding a **stale** key after a customer rotates their
key would fail every call until the container recycles.

## Decision

Cache each org's key in a `Map<orgId, key>` in warm containers with:

- a **short TTL** (e.g. ~5 minutes), and
- **eviction on a Bedrock `401/403`**: on an auth failure, drop that org's cached entry and re-fetch once
  from Secrets Manager before failing.

## Consequences

- Rotation heals within minutes (TTL) and self-heals immediately on the failing call (evict-on-auth).
- Slightly more logic than a plain cache, but avoids a Secrets Manager round-trip on every one of the
  many AI calls per request.
- The `evict-on-401/403` path must be careful to distinguish auth failures from unrelated errors so it
  doesn't mask real problems.

## Alternatives rejected

- **TTL only (no auth-failure eviction)** — simpler, but a rotated key keeps failing for up to the TTL
  window with no immediate self-heal.
- **No cache (fetch per invoke)** — always fresh, zero staleness, but adds a Secrets Manager round-trip
  (latency + cost) to every single AI call.

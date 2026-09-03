# 04 — Post-migration notification & cleanup

**What to build:** Close the loop with the shared-VPC owning team and make sure no stale documentation references the now-removed VPC dependency.

- Notify the `blueprint-checker` VPC owners that AutoRFP no longer depends on their NAT Gateway, so they can make their own call on the original EC2-NAT-instance / fck-nat migration (or any other NAT strategy change) based on their remaining tenants, without needing AutoRFP sign-off.
- Check `CLAUDE.md` (and any other architecture docs) for references to `IndexDocumentLambda` being VPC-attached or to AutoRFP depending on a NAT Gateway; update or remove any such references. (As of this migration's spec, `CLAUDE.md` does not currently mention a "VPC Lambda," so this may be a no-op — confirm rather than assume.)

**Blocked by:** 03 — Deploy to dev and verify functional/perf/error behavior (only notify once the change is confirmed working).

**Status:** ready-for-agent

- [ ] `blueprint-checker` VPC owners notified (e.g. Slack/email/ticket) that AutoRFP no longer depends on their NAT Gateway
- [ ] `CLAUDE.md` and other architecture docs checked for stale "VPC Lambda" / NAT Gateway dependency references; updated if any are found, or confirmed clean if not

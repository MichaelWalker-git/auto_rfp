---
name: team-definition
depth: Standard
keywords: []
description: Composed scope for the Team Definition personnel-management feature
skeleton: on
runner: true
---

# team-definition scope (composed)

Custom scope composed for the Team Definition feature: an org-level
personnel pool with primary/secondary roles, AI generation of the
employee list from CVs stored in org documents, résumé-to-role matching
(modeled on the existing past-performance matcher), and integration of
the approved team into the solution plan and TEAM_QUALIFICATIONS
generation. Composite ARS 47/100 (Standard band), method: fallback.

## Why these stages, why skip those

Mid-size brownfield feature spanning all four packages, but every hard
sub-problem has a working in-repo analogue (matching engine, AI document
generation, staffing plans). Ideation runs intent-capture,
scope-definition, rough-mockups, and approval-handoff to resolve the
org-level vs. opportunity-level framing gap and role semantics.
Inception runs reverse-engineering, requirements-analysis, domain-design,
and units-generation (~3 dependent units). Construction runs
functional-design, code-generation, and build-and-test.

Folds: feasibility and infrastructure-design fold into domain-design;
practices-discovery into reverse-engineering + build-and-test;
user-stories and nfr-requirements into requirements-analysis;
refined-mockups into a single rough-mockups pass; nfr-design is covered
by the existing RBAC/audit middleware; contract-design by the mandated
5-type Zod entity pattern; delivery-planning by inline unit sequencing
in units-generation. Market-research, team-formation, ci-pipeline, and
all operation stages skip — existing CI/CD and operational tooling
already cover them.

## Membership

Not keyword-inferable (composed scope, no keywords granted). 14 stages
EXECUTE / 19 SKIP, 11 approval gates, 2 per-unit stages.

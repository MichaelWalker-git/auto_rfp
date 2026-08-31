# Business Overview — AutoRFP (Solution-Plan Domain Focus)

> Code knowledge base built by intent `260821-solution-plan-versioning` (2026-08-27). This store's deep coverage is the **solution-plan versioning blast radius**; see `reverse-engineering-timestamp.md` → `## Scope of Analysis` before relying on it for other areas.

## Business Domain & Purpose

**AutoRFP** is an AI-powered RFP response automation platform for government contractors. It helps contractors find opportunities (SAM.gov integration), understand them (executive briefs), decide how to respond (solution plan), and produce the response artifacts (AI answer generation via RAG, proposal/RFP document generation, knowledge-base management).

The platform is multi-tenant: every entity is scoped to an organization (`orgId`), then typically to a project and an opportunity.

## The Solution Plan — Business Role

The **solution plan** is the strategic backbone of an opportunity response. It is the single source of truth (SoT) that downstream document generation reads:

- **Creation ("grilling")**: the user initiates a plan run; an AI-driven interview loop (the "grilling" rounds) runs asynchronously via an SQS worker, then a synthesis step produces the plan as an HTML document stored in S3, plus an embedded cost schedule and (via the team-definition feature) a recommended project team (`planTeam`).
- **Human refinement**: the user edits the plan HTML in a TipTap editor (optimistic-concurrency protected), and can save or regenerate the plan team.
- **Consumption**: when the plan is `READY`, document generation loads the plan HTML as source-of-truth context, stamps generated documents with `solutionPlanId` + `solutionPlanVersion`, feeds `costSchedule` into pricing prompts, and TEAM_QUALIFICATIONS generation reads `planTeam.members`.
- **Staleness**: upstream changes (executive-brief init/regenerate, new solicitation upload) mark the plan stale (`isStale` + `staleReason`) so the user knows the plan may no longer reflect the opportunity.

## Key Functionality in the Scanned Area

| Capability | Business value |
|---|---|
| Grilling → synthesis pipeline | Converts an AI interview into an approved, versioned solution plan (SoT) |
| Manual plan editing | Human ownership of the final plan text with conflict protection |
| Plan team (PlanTeam) save/regenerate | Team recommendation embedded in the plan; user edits survive per BR1.2 |
| Plan-gated document generation | Documents are only generated from a READY plan and record which plan version they used |
| Staleness signalling | Prevents silent use of an outdated plan after upstream changes |
| Version-history precedent (RFP documents, questionnaires, required forms) | Existing user-facing version list / compare / revert / cherry-pick pattern the plan-versioning feature can copy |

## What "Version" Means Today (Business View)

Today the plan carries a **monotonic version counter** (never reset, per inline ADR-11) and every synthesis/manual-edit write produces a new retained S3 object at `.../solution-plan/v{version}/solution-plan.html`. However, there is **no user-facing version history** for the plan (no list, compare, revert), and some writes (team save/regenerate) bump the version without producing new content, while re-init overwrites the item losing `planTeam`/`costSchedule`. That gap is the business motivation for the `solution-plan-versioning` intent.

## Out of Scope for This Store

Answer generation, KB pipelines, SAM.gov sync, pricing/staffing beyond `costSchedule`, auth-stack internals, and e2e suites were not analyzed in this run — statements about them here are limited to their contact points with the solution plan.

# Business Overview — AutoRFP

## Purpose & Domain

**AutoRFP** is an AI-powered RFP (Request for Proposal) response automation platform for **government contractors**. It shortens the capture-to-proposal cycle by ingesting solicitation documents, extracting requirements and questions, generating grounded AI answers from an organization's own knowledge base, and producing full proposal documents.

The primary users are business-development and proposal teams at contracting firms who must respond to federal/state solicitations (SAM.gov, HigherGov opportunity feeds) under deadline pressure, citing real corporate experience, real personnel, and defensible pricing.

## Key Functionality

- **RFP document processing** — upload solicitation packages; a document pipeline (Step Functions) extracts text, chunks, and indexes content into Pinecone for retrieval.
- **AI answer generation (RAG)** — a Step Functions answer-generation pipeline produces answers to extracted RFP questions grounded in the org knowledge base.
- **Executive briefs** — structured opportunity briefs with named sections (summary, deadlines, requirements, contacts, risks, pricing, pastPerformance, scoring) that feed downstream generation.
- **Solution plans** — a per-opportunity synthesized plan produced by a two-agent "grilling" loop (Griller/Tech Lead + Synthesizer). The plan is a single HTML document (metadata in DynamoDB, body in S3) and acts as a **gate**: most AI document generation requires a READY solution plan.
- **Proposal / RFP document generation** — AI-generated document types (technical approach, cost proposal, TEAM_QUALIFICATIONS, etc.) via an SQS worker calling Bedrock, with content validation and retries.
- **Pricing & staffing** — org-level labor rates (position-based rate buildups: base/overhead/G&A/profit, onshore + offshore) and per-opportunity staffing plans (`{position, hours, rate, totalCost, phase}`).
- **Past-performance matching** — a semantic + deterministic engine that matches past projects to solicitation requirements (relevance scores, coverage/gap analysis) for use in generated narratives.
- **Knowledge base management** — org-scoped KBs ("Org Documents") holding uploaded documents with an indexing lifecycle into Pinecone.
- **Opportunity sourcing** — SAM.gov and HigherGov integrations; Google Drive and Linear integrations; real-time collaboration over a WebSocket API.
- **Multi-tenant orgs & RBAC** — Cognito-authenticated users, org membership, and a permission-string RBAC model (`<domain>:<action>`).

## Business-Critical Gap (current initiative context)

The **Team Definition** initiative addresses a known functional hole: government proposals require named key personnel, but **the system has no personnel/employee entity at all** — no schema, no handler domain, no Pinecone index type for people. Today:

- "Team" exists only as **abstract roles**: `LaborRate.position` strings and staffing-plan lines — no person identity anywhere.
- The solution plan's Griller already mandates a "TEAM COMPOSITION" coverage area, but the output is free prose inside HTML.
- The `TEAM_QUALIFICATIONS` document type demands "ACTUAL names and bios from the Knowledge Base — do not invent personnel", yet KB retrieval is generic semantic search over uploaded org documents. Unless résumés happen to be uploaded, the model has nothing real to cite. **Hypothesis** (mechanism, not verified against production logs): the model either fabricates or emits thin/placeholder content that content validation rejects, exhausting 3 retries into FAILED.

The confirmed direction (project rules, learned 2026-08-19): an org-level employee pool page (general employee-management surface, roles/CV data only), AI CV extraction with **direct import** (no draft-review step), a recommended-team experience **inside the solution plan** (modifiable, with per-person match rationale), and repaired TEAM_QUALIFICATIONS generation — shipped as one release, built dependency-first.

## Value Proposition Summary

| Capability | Business value |
|---|---|
| Requirement/question extraction | Days of manual solicitation shredding → minutes |
| Grounded RAG answers & documents | Compliant, evidence-backed proposal content |
| Solution-plan gate | Forces a coherent technical strategy before generation |
| Past-performance matching | Automates the highest-scoring evaluation factor |
| Pricing/staffing tools | Defensible, auditable cost volumes |
| (Planned) Employee pool + team matching | Real named personnel in team-qualifications volumes |

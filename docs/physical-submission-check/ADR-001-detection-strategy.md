# ADR-001: Detection Strategy — Regex-First with AI Fallback at Two Pipeline Points

## Status

Accepted

## Context

Physical submission requirements in government RFPs are buried in solicitation documents (typically Section L — Instructions to Offerors, or Section M — Evaluation Criteria). These sections can appear anywhere in documents that are hundreds of pages long. Detection must be reliable, fast, and integrated into the existing processing pipeline without adding new infrastructure.

The codebase already has an established pattern for this kind of analysis: `scanDeliveryLocationConstraint()` — a deterministic regex scan over the full solicitation text that runs during executive brief generation. It takes precedence over the LLM for unambiguous clauses, with the AI extraction serving as a fallback.

## Decision

### Two detection points

1. **Lightweight scan at SAM.gov import** — When an opportunity is imported from SAM.gov, scan the structured metadata fields and description text for physical submission indicators. This provides the earliest possible signal, before any documents are uploaded or processed.

2. **Thorough scan during executive brief generation** — A deterministic regex scan (`scanPhysicalSubmission()`) runs over the full raw solicitation text (before truncation) in the `runSummary()` function of `exec-brief-worker.ts`. This is placed right after the existing `scanDeliveryLocationConstraint()` call. The AI prompt for the summary/requirements sections also extracts submission method as a structured field, serving as a fallback when the regex returns null.

### Detection priority (highest to lowest)

1. Regex scan result on full solicitation text (deterministic, reliable for explicit language)
2. LLM extraction from brief prompt (catches subtler phrasing)
3. SAM.gov import scan (early but based on limited text)

The thorough scan (during brief) overwrites the SAM.gov import result when it runs, since it has access to the full solicitation documents.

### Regex categories

**PHYSICAL indicators** (any match → `PHYSICAL` or `BOTH`):
- "mail proposals to", "submit hard copies", "deliver to the following address"
- "hand-deliver", "USPS", "FedEx", "certified mail", "overnight delivery"
- "physical copies required", "original plus N copies"

**ELECTRONIC indicators** (confirms no physical requirement):
- "submit electronically", "electronic submission only"
- "no hard copies", "no physical copies"
- "submit via SAM.gov / email / portal"

**BOTH**: text contains indicators from both categories.

### Address extraction

After detecting PHYSICAL or BOTH, the scanner attempts to extract a US mailing address from the ~500 characters surrounding the match. Returns structured `FoiaComponentAddressSchema` fields (best-effort).

## Alternatives Considered

### A. Dedicated AI-only analysis (separate Bedrock call)
A focused AI call that only looks at submission-related sections. **Rejected** because: adds latency + cost, non-deterministic, and the regex-first pattern is already proven in the codebase. The existing AI extraction in the brief prompt provides sufficient fallback coverage.

### B. Keyword + AI hybrid (pre-filter then AI)
Fast keyword search to find relevant pages, then send only those to AI. **Rejected** because: over-engineered for this use case. The regex scan is already doing the keyword search, and the full solicitation text is already loaded for the brief prompt — no need for a separate pre-filtering step.

### C. Scan at document pipeline step function level
Run the check at the end of the document pipeline (after text extraction, before brief). **Rejected** because: the document pipeline processes individual documents, not the merged solicitation text. The brief worker already has the merged text loaded, so it's the natural integration point. SAM.gov import covers the "earliest possible" detection need.

## Consequences

- Detection is reliable for explicit submission language (regex) and covers edge cases (AI fallback)
- No new infrastructure (queues, lambdas) — just a function call in existing code paths
- Two chances to catch physical submissions (import + brief) with the thorough check being authoritative
- False negatives are possible for highly unusual phrasing — the manual toggle serves as the safety net
- The scanner must be maintained as new solicitation language patterns are discovered

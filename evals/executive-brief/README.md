# Executive Brief Evals

Promptfoo evaluations for the executive brief pipeline — each section tested independently, plus an overall quality eval.

## Structure

```
evals/executive-brief/
├── rfp-texts/              # Shared solicitation source documents
├── ground-truth/           # Human-verified facts per RFP (used by overall eval)
├── prompts/                # Shared prompt files (system + user chat JSON)
├── sections/               # Per-section evals
│   ├── summary/            # Pure extraction: title, agency, NAICS, etc.
│   ├── deadlines/          # Pure extraction: dates, timezones, warnings
│   ├── requirements/       # Pure extraction: requirements, eval factors, compliance
│   ├── contacts/           # Pure extraction: names, roles, emails, phones
│   ├── risks/              # Uses KB + tools in prod (eval is extraction-only)
│   ├── pricing/            # Uses KB + tools in prod (eval is extraction-only)
│   └── scoring/            # Uses all section data + KB + tools in prod
└── overall/                # Full brief eval (all sections + cross-cutting rubrics)
```

## Running Evals

```bash
# Single section
cd evals/executive-brief/sections/summary
npx promptfoo eval

# View results
npx promptfoo view

# All sections (parallel)
for s in summary deadlines requirements contacts risks pricing scoring; do
  (cd evals/executive-brief/sections/$s && npx promptfoo eval) &
done
wait

# Overall (uses exported DynamoDB briefs, no LLM call — echo provider)
cd evals/executive-brief/overall
npx promptfoo eval
```

## Section Status

| Section | Config | Test Cases | Baselines | Notes |
|---------|--------|------------|-----------|-------|
| summary | Done | 3 tests | 2026-04-16 | 100% pass rate |
| deadlines | Done | 3 tests | 2026-04-16 | 100% pass rate |
| requirements | Done | 3 tests | 2026-04-16 | 100% pass rate |
| contacts | Done | 3 tests | 2026-04-16 | 100% pass rate; output transform strips markdown fences |
| risks | Done | 3 tests | 2026-04-16 | 100% pass rate; extraction-only (no KB/tools) |
| pricing | Done | 4 tests | 2026-04-16 | 100% pass rate; extraction-only (no KB/tools) |
| scoring | Placeholder | TODO | — | Needs section data as vars |
| overall | Done | 5 tests | 2026-04-15 | Uses exported DynamoDB briefs |

## Adding Test Cases

1. Place the RFP text in `rfp-texts/<name>.txt`
2. Create a test case JSON in `sections/<section>/test-cases/<name>.json` (if needed)
3. Add the test to the section's `promptfooconfig.yaml` with ground-truth assertions
4. Run the eval and save baseline: `npx promptfoo eval -o sections/<section>/baselines/YYYY-MM-DD.json`

## Key Metrics

- **ValidJSON** / **SchemaCompliance**: Structural checks (pass/fail)
- **FieldExtractionAccuracy**: LLM-graded, how well fields match gold standard (1-5)
- **HallucinationDetection**: LLM-graded, checks for fabricated data (1-5)
- **OmissionDiscipline**: LLM-graded, correct handling of absent fields (1-5)
- **CrossSectionConsistency** (overall only): Do sections tell a coherent story?
- **OverallFaithfulness** (overall only): Is the brief grounded in the solicitation?
- **Actionability** (overall only): Can a BD lead make a decision from this brief?

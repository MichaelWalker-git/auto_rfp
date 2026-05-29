# Past Performance Matching Feature - Implementation Documentation

## Overview

This document outlines the implementation plan for the Past Performance Matching feature, which automatically matches relevant past projects to RFP requirements. This is critical for the Bid/No-Bid decision (Criterion 2: Past Performance Relevance).

## Business Context

- Past performance is the #1 evaluation factor (often 30-40% of score)
- Must prove you've done similar work
- Missing relevant past performance = no bid
- Manual search is time-consuming

## Architecture Overview

### Current System Architecture

The system follows a serverless architecture using:
- **AWS Lambda** for compute
- **DynamoDB** for data storage (single-table design)
- **Pinecone** for vector embeddings and semantic search
- **AWS Bedrock** for AI/ML (embeddings with Titan, generation with Claude)
- **SQS** for async job processing
- **API Gateway** for REST endpoints

### Integration Points

1. **Executive Brief System** - Past performance will be a new section in the executive brief
2. **Knowledge Base** - Past projects stored in organization's knowledge base
3. **Pinecone** - Semantic search for matching projects
4. **Scoring System** - Feed into Bid/No-Bid Criterion 2

## Data Model Design

### PastProject Schema

```typescript
// shared/src/schemas/past-performance.ts

import { z } from 'zod';

export const ContactInfoSchema = z.object({
  name: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  organization: z.string().optional().nullable(),
});

export type ContactInfo = z.infer<typeof ContactInfoSchema>;

export const PastProjectSchema = z.object({
  projectId: z.string().uuid(),
  orgId: z.string().uuid(),
  title: z.string().min(1),
  client: z.string().min(1),
  clientPOC: ContactInfoSchema.optional().nullable(),
  contractNumber: z.string().optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  value: z.number().nonnegative().optional().nullable(),
  description: z.string().min(10),
  technicalApproach: z.string().optional().nullable(),
  achievements: z.array(z.string()).default([]),
  performanceRating: z.number().min(1).max(5).optional().nullable(),
  
  // Categorization
  domain: z.string().optional().nullable(), // e.g., "Healthcare", "Defense", "Finance"
  technologies: z.array(z.string()).default([]),
  naicsCodes: z.array(z.string()).default([]),
  contractType: z.string().optional().nullable(),
  setAside: z.string().optional().nullable(),
  
  // Scale metrics
  teamSize: z.number().int().positive().optional().nullable(),
  durationMonths: z.number().int().positive().optional().nullable(),
  
  // Metadata
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  isArchived: z.boolean().default(false),
});

export type PastProject = z.infer<typeof PastProjectSchema>;

// Match result from semantic search
export const PastProjectMatchSchema = z.object({
  project: PastProjectSchema,
  relevanceScore: z.number().min(0).max(100),
  matchDetails: z.object({
    technicalSimilarity: z.number().min(0).max(100),
    domainSimilarity: z.number().min(0).max(100),
    scaleSimilarity: z.number().min(0).max(100),
    recency: z.number().min(0).max(100),
    successMetrics: z.number().min(0).max(100),
  }),
  matchedRequirements: z.array(z.string()).default([]),
  narrative: z.string().optional().nullable(),
});

export type PastProjectMatch = z.infer<typeof PastProjectMatchSchema>;

// Gap analysis result
export const RequirementCoverageSchema = z.object({
  requirement: z.string(),
  status: z.enum(['COVERED', 'PARTIAL', 'GAP']),
  matchedProject: PastProjectMatchSchema.optional().nullable(),
  matchScore: z.number().min(0).max(100).optional().nullable(),
  recommendation: z.string().optional().nullable(),
});

export type RequirementCoverage = z.infer<typeof RequirementCoverageSchema>;

export const GapAnalysisSchema = z.object({
  coverageItems: z.array(RequirementCoverageSchema),
  overallCoverage: z.number().min(0).max(100),
  criticalGaps: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
});

export type GapAnalysis = z.infer<typeof GapAnalysisSchema>;

// Past Performance Section for Executive Brief
export const PastPerformanceSectionSchema = z.object({
  topMatches: z.array(PastProjectMatchSchema).max(5),
  gapAnalysis: GapAnalysisSchema,
  narrativeSummary: z.string().optional().nullable(),
  confidenceScore: z.number().min(0).max(100).optional().nullable(),
  evidence: z.array(z.object({
    source: z.string().optional().nullable(),
    snippet: z.string().optional().nullable(),
  })).default([]),
});

export type PastPerformanceSection = z.infer<typeof PastPerformanceSectionSchema>;

// DynamoDB keys
export const PAST_PROJECT_PK = 'PAST_PROJECT';

export function createPastProjectSK(orgId: string, projectId: string): string {
  return `${orgId}#${projectId}`;
}

export function parsePastProjectSK(sk: string): { orgId: string; projectId: string } | null {
  const parts = sk.split('#');
  if (parts.length !== 2) return null;
  return { orgId: parts[0], projectId: parts[1] };
}

// Request/Response DTOs
export const CreatePastProjectDTOSchema = z.object({
  orgId: z.string().uuid(),
  title: z.string().min(1),
  client: z.string().min(1),
  clientPOC: ContactInfoSchema.optional(),
  contractNumber: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  value: z.number().nonnegative().optional(),
  description: z.string().min(10),
  technicalApproach: z.string().optional(),
  achievements: z.array(z.string()).optional(),
  performanceRating: z.number().min(1).max(5).optional(),
  domain: z.string().optional(),
  technologies: z.array(z.string()).optional(),
  naicsCodes: z.array(z.string()).optional(),
  contractType: z.string().optional(),
  setAside: z.string().optional(),
  teamSize: z.number().int().positive().optional(),
  durationMonths: z.number().int().positive().optional(),
});

export type CreatePastProjectDTO = z.infer<typeof CreatePastProjectDTOSchema>;

export const UpdatePastProjectDTOSchema = CreatePastProjectDTOSchema.partial().omit({ orgId: true });

export type UpdatePastProjectDTO = z.infer<typeof UpdatePastProjectDTOSchema>;

export const MatchProjectsRequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  topK: z.number().int().min(1).max(10).optional().default(5),
  force: z.boolean().optional().default(false),
});

export type MatchProjectsRequest = z.infer<typeof MatchProjectsRequestSchema>;

export const GenerateNarrativeRequestSchema = z.object({
  executiveBriefId: z.string().min(1),
  projectMatches: z.array(PastProjectMatchSchema),
});

export type GenerateNarrativeRequest = z.infer<typeof GenerateNarrativeRequestSchema>;
```

## Lambda Functions Design

### 1. match-projects.ts

**Purpose**: Match RFP requirements against past projects using semantic search.

**Flow**:
1. Load executive brief and solicitation text
2. Extract key requirements from the brief
3. Generate embeddings for requirements
4. Search Pinecone for similar past projects
5. Calculate relevance scores using weighted formula
6. Return top N matches

**Relevance Score Formula**:
```
relevanceScore = (
  technicalSimilarity * 0.40 +   // Similar tech/methods
  domainSimilarity * 0.25 +      // Similar industry/domain
  scaleSimilarity * 0.20 +       // Similar size/complexity
  recency * 0.10 +               // How recent
  successMetrics * 0.05          // Performance ratings
) * 100
```

### 2. generate-narrative.ts

**Purpose**: Generate past performance narrative for each matched project.

**Flow**:
1. Load matched projects
2. Load solicitation requirements
3. Use Claude to generate tailored narrative
4. Extract key metrics and achievements
5. Format for proposal inclusion

### 3. gap-analysis.ts

**Purpose**: Identify gaps in past performance coverage.

**Flow**:
1. Load all RFP requirements
2. Map each requirement to best matching project
3. Identify requirements with no/weak matches
4. Generate recommendations (e.g., subcontractor suggestions)
5. Calculate overall coverage score

## API Endpoints Design

### New Routes: `infrastructure/lib/api/routes/pastperf.routes.ts`

```typescript
import type { DomainRoutes } from './types';

export function pastperfDomain(args: {
  execBriefQueueUrl: string;
}): DomainRoutes {
  const { execBriefQueueUrl } = args;

  return {
    basePath: 'pastperf',
    routes: [
      // Past Project CRUD
      {
        method: 'POST',
        path: 'create-project',
        entry: 'lambda/pastperf/create-project.ts',
      },
      {
        method: 'POST',
        path: 'update-project',
        entry: 'lambda/pastperf/update-project.ts',
      },
      {
        method: 'POST',
        path: 'delete-project',
        entry: 'lambda/pastperf/delete-project.ts',
      },
      {
        method: 'POST',
        path: 'get-project',
        entry: 'lambda/pastperf/get-project.ts',
      },
      {
        method: 'POST',
        path: 'list-projects',
        entry: 'lambda/pastperf/list-projects.ts',
      },
      
      // Matching & Analysis
      {
        method: 'POST',
        path: 'match-projects',
        entry: 'lambda/pastperf/match-projects.ts',
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
      {
        method: 'POST',
        path: 'generate-narrative',
        entry: 'lambda/pastperf/generate-narrative.ts',
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
      {
        method: 'POST',
        path: 'gap-analysis',
        entry: 'lambda/pastperf/gap-analysis.ts',
        extraEnv: { EXEC_BRIEF_QUEUE_URL: execBriefQueueUrl },
      },
    ],
  };
}
```

## Executive Brief Integration

### Update Executive Brief Schema

Add `pastPerformance` section to the executive brief:

```typescript
// In shared/src/schemas/executive-opportunity-brief.ts

export const ExecutiveBriefItemSchema = z.object({
  // ... existing fields ...
  sections: z.object({
    summary: SectionWrapperSchema(QuickSummarySchema),
    deadlines: SectionWrapperSchema(DeadlinesSectionSchema),
    requirements: SectionWrapperSchema(RequirementsSectionSchema),
    contacts: SectionWrapperSchema(ContactsSectionSchema),
    risks: SectionWrapperSchema(RisksSectionSchema),
    pastPerformance: SectionWrapperSchema(PastPerformanceSectionSchema), // NEW
    scoring: SectionWrapperSchema(ScoringSectionSchema),
  }),
  // ... existing fields ...
});
```

### Update Scoring Prompts

Modify the scoring system prompt to include past performance as Criterion 2:

```typescript
// Add to SCORING_SYSTEM_PROMPT
'2. PAST_PERFORMANCE (30% weight): Do we have relevant past performance?',
'   - 5: Multiple highly relevant projects with excellent ratings',
'   - 4: Good relevant experience, minor gaps',
'   - 3: Some relevant experience, notable gaps',
'   - 2: Limited relevant experience, significant gaps',
'   - 1: No relevant past performance',
```

## Pinecone Integration

### Index Past Projects

When a past project is created/updated, index it to Pinecone:

```typescript
// infrastructure/lambda/helpers/past-performance.ts

export async function indexPastProjectToPinecone(
  orgId: string,
  project: PastProject
): Promise<string> {
  const client = getPineconeClient();
  const index = client.Index(PINECONE_INDEX);
  
  // Create rich text for embedding
  const textForEmbedding = [
    project.title,
    project.description,
    project.technicalApproach,
    project.domain,
    project.technologies.join(', '),
    project.achievements.join('. '),
  ].filter(Boolean).join('\n\n');
  
  const embedding = await getEmbedding(textForEmbedding);
  const id = `past_project#${project.projectId}`;
  
  await index.namespace(orgId).upsert([{
    id,
    values: embedding,
    metadata: {
      id,
      type: 'past_project',
      projectId: project.projectId,
      title: project.title,
      client: project.client,
      domain: project.domain,
      technologies: project.technologies,
      naicsCodes: project.naicsCodes,
      value: project.value,
      performanceRating: project.performanceRating,
      startDate: project.startDate,
      endDate: project.endDate,
      createdAt: nowIso(),
    },
  }]);
  
  return id;
}
```

## Frontend Components

### New Components

1. **PastPerformanceCard.tsx** - Display matched projects in executive brief
2. **GapAnalysisCard.tsx** - Show coverage analysis with visual indicators
3. **PastProjectForm.tsx** - CRUD form for managing past projects
4. **PastProjectsList.tsx** - List view of organization's past projects

### Update ExecutiveBriefView.tsx

Add past performance section to the brief view:

```typescript
// Add to ExecutiveBriefView.tsx
import { PastPerformanceCard } from './components/PastPerformanceCard';
import { GapAnalysisCard } from './components/GapAnalysisCard';

// In the render:
const pastPerformance = briefItem?.sections?.pastPerformance?.data;

// Add to JSX:
<PastPerformanceCard pastPerformance={pastPerformance} />
<GapAnalysisCard gapAnalysis={pastPerformance?.gapAnalysis} />
```

## Implementation Steps

### Phase 1: Data Model & Schema (2 hours)
1. Create `shared/src/schemas/past-performance.ts`
2. Update `shared/src/schemas/index.ts` to export new schemas
3. Update `shared/src/schemas/executive-opportunity-brief.ts` to include pastPerformance section

### Phase 2: Backend Infrastructure (4 hours)
1. Create `infrastructure/lambda/pastperf/` Lambda functions:
   - `create-project.ts`
   - `update-project.ts`
   - `delete-project.ts`
   - `get-project.ts`
   - `list-projects.ts`
   - `match-projects.ts`
   - `generate-narrative.ts`
   - `gap-analysis.ts`
2. Create `infrastructure/lambda/helpers/past-performance.ts`
3. Create `infrastructure/lib/api/routes/pastperf.routes.ts`
4. Update `infrastructure/lib/api/api-orchestrator-stack.ts` to include new routes

### Phase 3: Prompts & AI Integration (2 hours)
1. Add past performance prompts to `infrastructure/lambda/constants/prompt.ts`
2. Update scoring prompts to include Criterion 2
3. Create narrative generation prompts

### Phase 4: Executive Brief Integration (2 hours)
1. Update `exec-brief-worker.ts` to handle pastPerformance section
2. Add section generation triggers
3. Update scoring prerequisites

### Phase 5: Frontend Components (3 hours)
1. Create `web-app/components/brief/components/PastPerformanceCard.tsx`
2. Create `web-app/components/brief/components/GapAnalysisCard.tsx`
3. Create `web-app/components/pastperf/` directory with CRUD components
4. Update `ExecutiveBriefView.tsx`
5. Add API hooks in `web-app/lib/hooks/use-past-performance.ts`

### Phase 6: Testing & Integration (1 hour)
1. Test with sample RFPs
2. Verify semantic matching accuracy
3. Test gap analysis
4. End-to-end testing

## Acceptance Criteria

- [ ] Semantic matching working with Pinecone
- [ ] Relevance scoring accurate (weighted formula)
- [ ] Auto-selection of top 3-5 projects
- [ ] Gap analysis identifies missing areas
- [ ] Reference data extracted correctly
- [ ] Narrative generation produces quality output
- [ ] Integration with Executive Brief complete
- [ ] Tested with sample RFPs

## File Structure

```
infrastructure/
├── lambda/
│   ├── pastperf/
│   │   ├── create-project.ts
│   │   ├── update-project.ts
│   │   ├── delete-project.ts
│   │   ├── get-project.ts
│   │   ├── list-projects.ts
│   │   ├── match-projects.ts
│   │   ├── generate-narrative.ts
│   │   └── gap-analysis.ts
│   ├── helpers/
│   │   └── past-performance.ts
│   └── constants/
│       └── prompt.ts (updated)
├── lib/
│   └── api/
│       └── routes/
│           └── pastperf.routes.ts

shared/
└── src/
    └── schemas/
        ├── past-performance.ts (new)
        ├── executive-opportunity-brief.ts (updated)
        └── index.ts (updated)

web-app/
├── components/
│   ├── brief/
│   │   └── components/
│   │       ├── PastPerformanceCard.tsx (new)
│   │       └── GapAnalysisCard.tsx (new)
│   └── pastperf/
│       ├── PastProjectForm.tsx (new)
│       └── PastProjectsList.tsx (new)
└── lib/
    └── hooks/
        └── use-past-performance.ts (new)
```

## Priority

**P0 - Critical for Bid/No-Bid (Criterion 2)**

## Estimated Hours

**14 hours total**
- Phase 1: 2 hours
- Phase 2: 4 hours
- Phase 3: 2 hours
- Phase 4: 2 hours
- Phase 5: 3 hours
- Phase 6: 1 hour
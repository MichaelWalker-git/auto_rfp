# Pricing System Integration into Executive Brief

> **Status**: Architecture Complete — Ready for Implementation
> **Priority**: P0 — Critical for Bid/No-Bid decision (Criterion 3: Pricing Position)
> **Estimated Hours**: 18 hours
> **Integration Point**: Executive Brief System (new pricing section)

---

## Overview

| **Feature** | **Value** |
|---|---|
| **Business Context** | Pricing errors = immediate disqualification. Need competitive but profitable pricing for Bid/No-Bid decisions. |
| **Integration Strategy** | Add new `pricing` section to existing Executive Brief workflow alongside summary, deadlines, requirements, contacts, risks, scoring |
| **Technical Approach** | Extend `ExecutiveBriefItemSchema` with pricing section, add pricing tools to brief generation, integrate with existing PRICING_POSITION scoring criterion |
| **Data Storage** | Leverage existing single-table DynamoDB design with new PK constants for labor rates and estimates |
| **Frontend Integration** | New pricing cards in Executive Brief UI, separate pricing management pages for labor rate setup |
| **Document Generation** | Pricing data available to RFP document generation for Price/Cost Volume documents |
| **Decision Integration** | GO/NO-GO decision calculation properly weighs pricing position (15% weight) |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXECUTIVE BRIEF SYSTEM                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────┐ │
│  │   Summary   │ │ Deadlines   │ │Requirements │ │  Contacts   │ │  Risks  │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └─────────┘ │
│                                       │                                      │
│  ┌─────────────┐ ┌─────────────────────▼─────────────────────┐ ┌─────────────┐ │
│  │   PRICING   │ │              SCORING                      │ │Past Perf    │ │
│  │ (NEW)       │ │  • TECHNICAL_FIT                         │ │             │ │
│  │             │ │  • PAST_PERFORMANCE_RELEVANCE            │ │             │ │
│  │ • Labor     │ │  • PRICING_POSITION ← Fed by Pricing    │ │             │ │
│  │ • BOM       │ │  • STRATEGIC_ALIGNMENT                   │ │             │ │
│  │ • Staffing  │ │  • INCUMBENT_RISK                        │ │             │ │
│  │ • Estimate  │ │                                          │ │             │ │
│  └─────────────┘ └──────────────────────────────────────────┘ └─────────────┘ │
│                                       │                                      │
│                              ┌────────▼────────┐                             │
│                              │ GO/NO-GO/COND   │                             │
│                              │    DECISION     │                             │
│                              └─────────────────┘                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         PRICING DATA MANAGEMENT                             │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐                │
│  │  Labor Rates    │ │   BOM Items     │ │ Staffing Plans  │                │
│  │  PK: LABOR_RATE │ │  PK: BOM_ITEM   │ │ PK: STAFFING    │                │
│  │  SK: org#pos    │ │  SK: org#cat#id │ │ SK: org#proj#id │                │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Data Models & Zod Schemas <!-- ⏳ PENDING -->

**File**: `packages/core/src/schemas/pricing.ts`

```typescript
import { z } from 'zod';

/**
 * ================
 * LABOR RATES
 * ================
 */
export const LaborRateSchema = z.object({
  laborRateId: z.string().uuid(),
  orgId: z.string().uuid(),
  position: z.string().min(1).max(100), // e.g., "Senior Engineer"
  baseRate: z.number().positive(), // Hourly rate
  overhead: z.number().min(0).max(500), // Percentage (e.g., 150.5 for 150.5%)
  ga: z.number().min(0).max(100), // G&A percentage
  profit: z.number().min(0).max(100), // Profit margin percentage
  fullyLoadedRate: z.number().positive(), // Final billable rate (calculated)
  effectiveDate: z.string().datetime(),
  expirationDate: z.string().datetime().optional(),
  isActive: z.boolean().default(true),
  rateJustification: z.string().max(500).optional(), // GSA schedule, market research, etc.
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
});

export type LaborRate = z.infer<typeof LaborRateSchema>;

export const CreateLaborRateSchema = LaborRateSchema.omit({
  laborRateId: true,
  fullyLoadedRate: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
});

export type CreateLaborRate = z.infer<typeof CreateLaborRateSchema>;

/**
 * ================
 * BOM ITEMS
 * ================
 */
export const BOMItemTypeSchema = z.enum([
  'HARDWARE',
  'SOFTWARE_LICENSE',
  'MATERIALS',
  'SUBCONTRACTOR',
  'TRAVEL',
  'ODC', // Other Direct Costs
]);

export const BOMItemSchema = z.object({
  bomItemId: z.string().uuid(),
  orgId: z.string().uuid(),
  category: BOMItemTypeSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  unitCost: z.number().positive(),
  unit: z.string().min(1).max(50), // "each", "license", "month", "trip"
  vendor: z.string().max(200).optional(),
  partNumber: z.string().max(100).optional(),
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
});

export type BOMItem = z.infer<typeof BOMItemSchema>;

export const CreateBOMItemSchema = BOMItemSchema.omit({
  bomItemId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
});

export type CreateBOMItem = z.infer<typeof CreateBOMItemSchema>;

/**
 * ================
 * STAFFING PLAN
 * ================
 */
export const StaffingPlanItemSchema = z.object({
  position: z.string().min(1).max(100), // Must match LaborRate.position
  hours: z.number().positive(),
  rate: z.number().positive(), // From LaborRate.fullyLoadedRate
  totalCost: z.number().positive(), // hours * rate
  phase: z.string().max(100).optional(), // "Phase 1", "Base Period", etc.
});

export const StaffingPlanSchema = z.object({
  staffingPlanId: z.string().uuid(),
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  name: z.string().min(1).max(200),
  laborItems: z.array(StaffingPlanItemSchema).min(1),
  totalLaborCost: z.number().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
});

export type StaffingPlan = z.infer<typeof StaffingPlanSchema>;

/**
 * ================
 * COST ESTIMATE
 * ================
 */
export const PricingStrategySchema = z.enum([
  'COST_PLUS',
  'FIXED_PRICE',
  'TIME_AND_MATERIALS',
  'COMPETITIVE_ANALYSIS',
]);

export const EstimateItemSchema = z.object({
  category: z.enum(['LABOR', 'HARDWARE', 'SOFTWARE', 'MATERIALS', 'SUBCONTRACTOR', 'TRAVEL', 'ODC']),
  name: z.string().min(1).max(200),
  quantity: z.number().positive(),
  unitCost: z.number().positive(),
  totalCost: z.number().positive(),
  phase: z.string().max(100).optional(),
});

export const CostEstimateSchema = z.object({
  estimateId: z.string().uuid(),
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  name: z.string().min(1).max(200),
  strategy: PricingStrategySchema,
  
  // Cost breakdown
  laborCosts: z.array(EstimateItemSchema),
  materialCosts: z.array(EstimateItemSchema),
  travelCosts: z.array(EstimateItemSchema),
  subcontractorCosts: z.array(EstimateItemSchema),
  odcCosts: z.array(EstimateItemSchema),
  
  // Totals
  totalDirectCost: z.number().positive(),
  totalIndirectCost: z.number().positive(),
  totalCost: z.number().positive(),
  margin: z.number().min(0).max(100), // Profit margin percentage
  totalPrice: z.number().positive(),
  
  // Competitive analysis
  competitivePosition: z.enum(['LOW', 'COMPETITIVE', 'HIGH']).optional(),
  historicalComparison: z.string().max(1000).optional(),
  
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
});

export type CostEstimate = z.infer<typeof CostEstimateSchema>;

/**
 * ================
 * PRICING SECTION (for Executive Brief)
 * ================
 */
export const PricingSectionSchema = z.object({
  estimateId: z.string().uuid().optional(),
  strategy: PricingStrategySchema,
  totalPrice: z.number().positive(),
  competitivePosition: z.enum(['LOW', 'COMPETITIVE', 'HIGH']),
  priceConfidence: z.number().int().min(0).max(100),
  
  // Summary breakdown
  laborCostTotal: z.number().positive(),
  materialCostTotal: z.number().positive(),
  indirectCostTotal: z.number().positive(),
  profitMargin: z.number().min(0).max(100),
  
  // Key insights for Bid/No-Bid
  competitiveAdvantages: z.array(z.string()).default([]),
  pricingRisks: z.array(z.string()).default([]),
  recommendedActions: z.array(z.string()).default([]),
  
  // Basis of estimate summary
  basisOfEstimate: z.string().max(2000),
  assumptions: z.array(z.string()).default([]),
});

export type PricingSection = z.infer<typeof PricingSectionSchema>;

/**
 * ================
 * REQUEST/RESPONSE SCHEMAS
 * ================
 */
export const CalculateEstimateRequestSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  strategy: PricingStrategySchema,
  laborItems: z.array(z.object({
    position: z.string().min(1),
    hours: z.number().positive(),
  })),
  bomItems: z.array(z.object({
    bomItemId: z.string().uuid(),
    quantity: z.number().positive(),
  })).optional(),
});

export type CalculateEstimateRequest = z.infer<typeof CalculateEstimateRequestSchema>;

export const GeneratePriceVolumeRequestSchema = z.object({
  orgId: z.string().uuid(),
  estimateId: z.string().uuid(),
  format: z.enum(['PDF', 'DOCX', 'XLSX']).default('PDF'),
});

export type GeneratePriceVolumeRequest = z.infer<typeof GeneratePriceVolumeRequestSchema>;
```

**Export from**: `packages/core/src/schemas/index.ts`
```typescript
export * from './pricing';
```

---

## 2. DynamoDB Design <!-- ⏳ PENDING -->

### PK Constants

**File**: `apps/functions/src/constants/pricing.ts`

```typescript
export const LABOR_RATE_PK = 'LABOR_RATE';
export const BOM_ITEM_PK = 'BOM_ITEM';
export const STAFFING_PLAN_PK = 'STAFFING_PLAN';
export const COST_ESTIMATE_PK = 'COST_ESTIMATE';
```

### Access Patterns

| Entity | PK | SK Pattern | Use Case |
|---|---|---|---|
| Labor Rate | `LABOR_RATE` | `{orgId}#{position}` | Get rates by org and position |
| BOM Item | `BOM_ITEM` | `{orgId}#{category}#{bomItemId}` | Get BOM items by org and category |
| Staffing Plan | `STAFFING_PLAN` | `{orgId}#{projectId}#{opportunityId}#{staffingPlanId}` | Get staffing for specific opportunity |
| Cost Estimate | `COST_ESTIMATE` | `{orgId}#{projectId}#{opportunityId}#{estimateId}` | Get estimates for specific opportunity |

### SK Builder Functions

**File**: `apps/functions/src/helpers/pricing.ts`

```typescript
import { PK_NAME, SK_NAME } from '@/constants/common';
import { LABOR_RATE_PK, BOM_ITEM_PK, STAFFING_PLAN_PK, COST_ESTIMATE_PK } from '@/constants/pricing';
import { createItem, putItem, getItem, queryBySkPrefix, deleteItem } from '@/helpers/db';
import type { LaborRate, BOMItem, StaffingPlan, CostEstimate } from '@auto-rfp/core';

// ─── SK Builders ───

export const createLaborRateSK = (orgId: string, position: string): string => 
  `${orgId}#${position}`;

export const createBOMItemSK = (orgId: string, category: string, bomItemId: string): string => 
  `${orgId}#${category}#${bomItemId}`;

export const createStaffingPlanSK = (orgId: string, projectId: string, opportunityId: string, staffingPlanId: string): string => 
  `${orgId}#${projectId}#${opportunityId}#${staffingPlanId}`;

export const createCostEstimateSK = (orgId: string, projectId: string, opportunityId: string, estimateId: string): string => 
  `${orgId}#${projectId}#${opportunityId}#${estimateId}`;

// ─── DynamoDB Helpers ───

export const createLaborRate = async (laborRate: LaborRate): Promise<LaborRate> => {
  const sk = createLaborRateSK(laborRate.orgId, laborRate.position);
  const item = { ...laborRate, [PK_NAME]: LABOR_RATE_PK, [SK_NAME]: sk };
  await createItem(item);
  return laborRate;
};

export const getLaborRatesByOrg = async (orgId: string): Promise<LaborRate[]> => {
  const items = await queryBySkPrefix(LABOR_RATE_PK, `${orgId}#`);
  return items as LaborRate[];
};

export const createBOMItem = async (bomItem: BOMItem): Promise<BOMItem> => {
  const sk = createBOMItemSK(bomItem.orgId, bomItem.category, bomItem.bomItemId);
  const item = { ...bomItem, [PK_NAME]: BOM_ITEM_PK, [SK_NAME]: sk };
  await createItem(item);
  return bomItem;
};

export const getBOMItemsByOrg = async (orgId: string, category?: string): Promise<BOMItem[]> => {
  const skPrefix = category ? `${orgId}#${category}#` : `${orgId}#`;
  const items = await queryBySkPrefix(BOM_ITEM_PK, skPrefix);
  return items as BOMItem[];
};

export const createCostEstimate = async (estimate: CostEstimate): Promise<CostEstimate> => {
  const sk = createCostEstimateSK(estimate.orgId, estimate.projectId, estimate.opportunityId, estimate.estimateId);
  const item = { ...estimate, [PK_NAME]: COST_ESTIMATE_PK, [SK_NAME]: sk };
  await createItem(item);
  return estimate;
};

export const getCostEstimateByOpportunity = async (
  orgId: string, 
  projectId: string, 
  opportunityId: string
): Promise<CostEstimate | null> => {
  const items = await queryBySkPrefix(COST_ESTIMATE_PK, `${orgId}#${projectId}#${opportunityId}#`);
  return items.length > 0 ? (items[0] as CostEstimate) : null;
};

// ─── Calculation Helpers ───

export const calculateFullyLoadedRate = (baseRate: number, overhead: number, ga: number, profit: number): number => {
  const withOverhead = baseRate * (1 + overhead / 100);
  const withGA = withOverhead * (1 + ga / 100);
  const withProfit = withGA * (1 + profit / 100);
  return Math.round(withProfit * 100) / 100;
};

export const calculateEstimateTotals = (
  laborCosts: Array<{ totalCost: number }>,
  materialCosts: Array<{ totalCost: number }>,
  travelCosts: Array<{ totalCost: number }>,
  subcontractorCosts: Array<{ totalCost: number }>,
  odcCosts: Array<{ totalCost: number }>,
  margin: number
): { totalDirectCost: number; totalIndirectCost: number; totalCost: number; totalPrice: number } => {
  const allCosts = [...laborCosts, ...materialCosts, ...travelCosts, ...subcontractorCosts, ...odcCosts];
  const totalDirectCost = allCosts.reduce((sum, item) => sum + item.totalCost, 0);
  const totalIndirectCost = 0; // Indirect costs are built into fully loaded rates
  const totalCost = totalDirectCost + totalIndirectCost;
  const totalPrice = totalCost * (1 + margin / 100);
  
  return {
    totalDirectCost: Math.round(totalDirectCost * 100) / 100,
    totalIndirectCost: Math.round(totalIndirectCost * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    totalPrice: Math.round(totalPrice * 100) / 100,
  };
};
```

---

## 3. Executive Brief Schema Extension <!-- ⏳ PENDING -->

**File**: `packages/core/src/schemas/executive-opportunity-brief.ts`

Add pricing section to the existing schema:

```typescript
// Add to imports
import { PricingSectionSchema } from './pricing';

// Update ExecutiveBriefItemSchema.sections
export const ExecutiveBriefItemSchema = z.object({
  // ... existing fields ...
  sections: z.object({
    summary: SectionWrapperSchema(QuickSummarySchema),
    deadlines: SectionWrapperSchema(DeadlinesSectionSchema),
    requirements: SectionWrapperSchema(RequirementsSectionSchema),
    contacts: SectionWrapperSchema(ContactsSectionSchema),
    risks: SectionWrapperSchema(RisksSectionSchema),
    pricing: SectionWrapperSchema(PricingSectionSchema), // NEW
    pastPerformance: SectionWrapperSchema(PastPerformanceSectionSchema),
    scoring: SectionWrapperSchema(ScoringSectionSchema),
  }),
  // ... rest unchanged ...
});
```

**File**: `apps/functions/src/handlers/brief/exec-brief-worker.ts`

Add pricing to the job schema and section handlers:

```typescript
// Update JobSchema
const JobSchema = z.object({
  // ... existing fields ...
  section: z.enum(['summary', 'deadlines', 'requirements', 'contacts', 'risks', 'pricing', 'scoring']),
  // ... rest unchanged ...
});

// Add pricing handler
async function runPricing(job: Job): Promise<void> {
  const { orgId, executiveBriefId, inputHash: inputHashFromJob } = job;

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    const projectId = brief.projectId;
    const opportunityId = brief.opportunityId as string;

    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'pricing',
        opportunityId,
        allTextKeys: brief.allTextKeys,
      });

    await markSectionInProgress({ executiveBriefId, section: 'pricing', inputHash });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);
    const kbPrimer = await loadKbPrimer(orgId, solicitationText, 3);

    // Get requirements section for context
    const requirementsData = (brief.sections as Record<string, { data?: unknown }>)?.requirements?.data;

    const data = await invokeClaudeWithTools({
      modelId: BEDROCK_MODEL_ID,
      system: await usePricingSystemPrompt(orgId),
      user: await usePricingUserPrompt(
        orgId,
        solicitationText,
        requirementsData ? JSON.stringify(requirementsData) : '',
        kbPrimer,
      ),
      tools: [...BRIEF_TOOLS, ...PRICING_TOOLS],
      toolExecutor: (toolName, toolInput, toolUseId) =>
        executePricingTool({ toolName, toolInput, toolUseId, orgId, projectId, opportunityId, executiveBriefId }),
      outputSchema: PricingSectionSchema,
      maxTokens: 6000,
      temperature: 0.2,
      maxToolRounds: 3,
    });

    await markSectionComplete({
      executiveBriefId,
      section: 'pricing',
      data,
      topLevelPatch: { status: 'IN_PROGRESS' },
    });
  } catch (err) {
    await markSectionFailed({ executiveBriefId, section: 'pricing', error: err });
    throw err;
  }
}

// Update section handlers
const sectionHandlers: Record<Section, (job: Job) => Promise<void>> = {
  summary: runSummary,
  deadlines: runDeadlines,
  requirements: runRequirements,
  contacts: runContacts,
  risks: runRisks,
  pricing: runPricing, // NEW
  scoring: runScoring,
};
```

---

## 4. AI Tools for Pricing Data Extraction <!-- ⏳ PENDING -->

**File**: `apps/functions/src/helpers/pricing-tools.ts`

```typescript
import { z } from 'zod';
import { getLaborRatesByOrg, getBOMItemsByOrg, calculateFullyLoadedRate } from './pricing';
import { queryCompanyKnowledgeBase } from './executive-opportunity-brief';
import { loadTextFromS3 } from './s3';
import { requireEnv } from './env';
import { invokeClaudeJson } from './executive-opportunity-brief';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');

export const PRICING_TOOLS = [
  {
    name: 'extract_labor_requirements',
    description: 'Extract labor categories, skill levels, and estimated hours from solicitation text using AI',
    input_schema: {
      type: 'object',
      properties: {
        solicitationText: { type: 'string', description: 'Solicitation text to analyze' },
        focusSection: { type: 'string', description: 'Optional: specific section to focus on (e.g., "Section C", "PWS")' },
      },
      required: ['solicitationText'],
    },
  },
  {
    name: 'extract_contract_value',
    description: 'Extract estimated contract value, ceiling, and period of performance from solicitation using AI',
    input_schema: {
      type: 'object',
      properties: {
        solicitationText: { type: 'string', description: 'Solicitation text to analyze' },
      },
      required: ['solicitationText'],
    },
  },
  {
    name: 'extract_pricing_evaluation_criteria',
    description: 'Extract price/cost evaluation factors and scoring methodology from solicitation using AI',
    input_schema: {
      type: 'object',
      properties: {
        solicitationText: { type: 'string', description: 'Solicitation text to analyze' },
      },
      required: ['solicitationText'],
    },
  },
  {
    name: 'extract_material_requirements',
    description: 'Extract hardware, software, and material requirements from solicitation using AI',
    input_schema: {
      type: 'object',
      properties: {
        solicitationText: { type: 'string', description: 'Solicitation text to analyze' },
        category: { 
          type: 'string', 
          enum: ['HARDWARE', 'SOFTWARE_LICENSE', 'MATERIALS', 'TRAVEL'],
          description: 'Optional: focus on specific category' 
        },
      },
      required: ['solicitationText'],
    },
  },
  {
    name: 'search_historical_pricing',
    description: 'Search knowledge base for historical pricing data from similar contracts',
    input_schema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
        query: { type: 'string', description: 'Search query for similar contracts or pricing data' },
        naicsCode: { type: 'string', description: 'Optional: NAICS code to filter results' },
        contractType: { type: 'string', description: 'Optional: contract type filter' },
      },
      required: ['orgId', 'query'],
    },
  },
  {
    name: 'analyze_incumbent_pricing',
    description: 'Analyze incumbent contractor pricing and performance data from knowledge base',
    input_schema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
        incumbentName: { type: 'string', description: 'Incumbent contractor name' },
        contractNumber: { type: 'string', description: 'Optional: current contract number' },
      },
      required: ['orgId', 'incumbentName'],
    },
  },
  {
    name: 'get_labor_rates',
    description: 'Get all active labor rates for the organization',
    input_schema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
        position: { type: 'string', description: 'Optional: filter by position name' },
      },
      required: ['orgId'],
    },
  },
  {
    name: 'get_bom_items',
    description: 'Get bill of materials items by category',
    input_schema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
        category: { 
          type: 'string', 
          enum: ['HARDWARE', 'SOFTWARE_LICENSE', 'MATERIALS', 'SUBCONTRACTOR', 'TRAVEL', 'ODC'],
          description: 'BOM item category' 
        },
      },
      required: ['orgId'],
    },
  },
  {
    name: 'calculate_labor_cost',
    description: 'Calculate total labor cost for given positions and hours',
    input_schema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
        laborItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              position: { type: 'string' },
              hours: { type: 'number' },
              phase: { type: 'string', description: 'Optional: project phase' },
            },
            required: ['position', 'hours'],
          },
        },
      },
      required: ['orgId', 'laborItems'],
    },
  },
  {
    name: 'analyze_competitive_position',
    description: 'Analyze competitive pricing position based on estimated value and market data',
    input_schema: {
      type: 'object',
      properties: {
        estimatedValue: { type: 'number', description: 'Government estimated contract value' },
        ourPrice: { type: 'number', description: 'Our calculated price' },
        contractType: { type: 'string', description: 'Contract type (FFP, T&M, etc.)' },
        naicsCode: { type: 'string', description: 'NAICS code for market analysis' },
        historicalData: { type: 'string', description: 'Historical pricing data context' },
      },
      required: ['estimatedValue', 'ourPrice'],
    },
  },
];

// ─── AI Extraction Functions ───

const extractLaborRequirementsFromText = async (
  solicitationText: string,
  focusSection?: string
): Promise<Array<{ position: string; skillLevel: string; estimatedHours: number; phase?: string }>> => {
  const extractionSchema = z.object({
    laborRequirements: z.array(z.object({
      position: z.string(),
      skillLevel: z.string(),
      estimatedHours: z.number(),
      phase: z.string().optional(),
      justification: z.string().optional(),
    })),
  });

  const systemPrompt = [
    'Extract labor requirements from government solicitation text.',
    'Focus on: position titles, skill levels, estimated hours, project phases.',
    'Output JSON only with laborRequirements array.',
  ].join('\n');

  const userPrompt = [
    'Extract all labor categories and requirements from this solicitation:',
    focusSection ? `Focus on: ${focusSection}` : '',
    '',
    'SOLICITATION TEXT:',
    solicitationText.slice(0, 20000), // Limit for token efficiency
  ].filter(Boolean).join('\n');

  const result = await invokeClaudeJson({
    modelId: BEDROCK_MODEL_ID,
    system: systemPrompt,
    user: userPrompt,
    outputSchema: extractionSchema,
    maxTokens: 2000,
    temperature: 0.1,
  });

  return result.laborRequirements;
};

const extractContractValueFromText = async (solicitationText: string) => {
  const valueSchema = z.object({
    estimatedValue: z.number().optional(),
    ceilingValue: z.number().optional(),
    periodOfPerformance: z.string().optional(),
    contractType: z.string().optional(),
    currency: z.string().default('USD'),
    valueSource: z.string().optional(),
  });

  const systemPrompt = [
    'Extract contract value and performance period from government solicitation.',
    'Look for: estimated value, ceiling value, IGCE, period of performance.',
    'Output JSON only.',
  ].join('\n');

  const userPrompt = [
    'Extract contract value information from this solicitation:',
    '',
    'SOLICITATION TEXT:',
    solicitationText.slice(0, 15000),
  ].join('\n');

  return await invokeClaudeJson({
    modelId: BEDROCK_MODEL_ID,
    system: systemPrompt,
    user: userPrompt,
    outputSchema: valueSchema,
    maxTokens: 1000,
    temperature: 0.1,
  });
};

const extractPricingEvaluationCriteria = async (solicitationText: string) => {
  const criteriaSchema = z.object({
    evaluationMethod: z.string().optional(),
    priceWeight: z.number().optional(),
    costFactors: z.array(z.string()).default([]),
    pricingInstructions: z.array(z.string()).default([]),
    tradeoffProcess: z.string().optional(),
  });

  const systemPrompt = [
    'Extract pricing evaluation criteria from government solicitation.',
    'Focus on: evaluation method, price weight, cost factors, pricing instructions.',
    'Output JSON only.',
  ].join('\n');

  const userPrompt = [
    'Extract pricing evaluation criteria from this solicitation:',
    'Look for Section M (Evaluation), pricing instructions, cost factors.',
    '',
    'SOLICITATION TEXT:',
    solicitationText.slice(0, 15000),
  ].join('\n');

  return await invokeClaudeJson({
    modelId: BEDROCK_MODEL_ID,
    system: systemPrompt,
    user: userPrompt,
    outputSchema: criteriaSchema,
    maxTokens: 1500,
    temperature: 0.1,
  });
};

const extractMaterialRequirementsFromText = async (
  solicitationText: string,
  category?: string
) => {
  const materialSchema = z.object({
    materials: z.array(z.object({
      name: z.string(),
      category: z.string(),
      quantity: z.number().optional(),
      unit: z.string().optional(),
      specifications: z.string().optional(),
    })),
  });

  const systemPrompt = [
    'Extract material, hardware, and equipment requirements from solicitation.',
    category ? `Focus on ${category} items only.` : 'Extract all material requirements.',
    'Output JSON only with materials array.',
  ].join('\n');

  const userPrompt = [
    'Extract material requirements from this solicitation:',
    '',
    'SOLICITATION TEXT:',
    solicitationText.slice(0, 15000),
  ].join('\n');

  const result = await invokeClaudeJson({
    modelId: BEDROCK_MODEL_ID,
    system: systemPrompt,
    user: userPrompt,
    outputSchema: materialSchema,
    maxTokens: 2000,
    temperature: 0.1,
  });

  return result.materials;
};

export const executePricingTool = async (params: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  executiveBriefId: string;
}): Promise<{ tool_use_id: string; content: string }> => {
  const { toolName, toolInput, toolUseId, orgId } = params;

  try {
    switch (toolName) {
      case 'extract_labor_requirements': {
        const { solicitationText, focusSection } = toolInput;
        
        const laborRequirements = await extractLaborRequirementsFromText(
          solicitationText as string,
          focusSection as string | undefined
        );
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            laborRequirements,
            extractedFrom: focusSection || 'full solicitation',
            count: laborRequirements.length,
          }),
        };
      }

      case 'extract_contract_value': {
        const { solicitationText } = toolInput;
        
        const contractValue = await extractContractValueFromText(solicitationText as string);
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            ...contractValue,
          }),
        };
      }

      case 'extract_pricing_evaluation_criteria': {
        const { solicitationText } = toolInput;
        
        const evaluationCriteria = await extractPricingEvaluationCriteria(solicitationText as string);
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            ...evaluationCriteria,
          }),
        };
      }

      case 'extract_material_requirements': {
        const { solicitationText, category } = toolInput;
        
        const materials = await extractMaterialRequirementsFromText(
          solicitationText as string,
          category as string | undefined
        );
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            materials,
            category: category || 'ALL',
            count: materials.length,
          }),
        };
      }

      case 'search_historical_pricing': {
        const { query, naicsCode, contractType } = toolInput;
        
        // Search KB for historical pricing data
        const kbMatches = await queryCompanyKnowledgeBase(
          orgId,
          `pricing cost estimate ${query} ${naicsCode || ''} ${contractType || ''}`.trim(),
          10
        );
        
        const historicalData = await Promise.all(
          (kbMatches ?? []).slice(0, 5).map(async (m, i) => {
            const text = m.source?.chunkKey
              ? await loadTextFromS3(DOCUMENTS_BUCKET, m.source.chunkKey).catch(() => '')
              : '';
            return {
              score: m.score,
              source: m.source?.documentId || 'unknown',
              snippet: text.slice(0, 500),
              chunkKey: m.source?.chunkKey,
            };
          })
        );
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            historicalData,
            searchQuery: query,
            resultsCount: historicalData.length,
          }),
        };
      }

      case 'analyze_incumbent_pricing': {
        const { incumbentName, contractNumber } = toolInput;
        
        const searchQuery = `${incumbentName} pricing cost contract ${contractNumber || ''}`.trim();
        const kbMatches = await queryCompanyKnowledgeBase(orgId, searchQuery, 8);
        
        const incumbentData = await Promise.all(
          (kbMatches ?? []).slice(0, 3).map(async (m) => {
            const text = m.source?.chunkKey
              ? await loadTextFromS3(DOCUMENTS_BUCKET, m.source.chunkKey).catch(() => '')
              : '';
            return {
              score: m.score,
              source: m.source?.documentId || 'unknown',
              snippet: text.slice(0, 400),
            };
          })
        );
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            incumbentName,
            contractNumber,
            incumbentData,
            dataPoints: incumbentData.length,
          }),
        };
      }

      case 'get_labor_rates': {
        const rates = await getLaborRatesByOrg(orgId);
        const filtered = toolInput.position 
          ? rates.filter(r => r.position.toLowerCase().includes((toolInput.position as string).toLowerCase()))
          : rates;
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            laborRates: filtered.map(r => ({
              position: r.position,
              baseRate: r.baseRate,
              overhead: r.overhead,
              ga: r.ga,
              profit: r.profit,
              fullyLoadedRate: r.fullyLoadedRate,
              rateJustification: r.rateJustification,
              effectiveDate: r.effectiveDate,
            })),
            count: filtered.length,
          }),
        };
      }

      case 'get_bom_items': {
        const items = await getBOMItemsByOrg(orgId, toolInput.category as string);
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            bomItems: items.map(item => ({
              name: item.name,
              category: item.category,
              unitCost: item.unitCost,
              unit: item.unit,
              vendor: item.vendor,
              description: item.description,
              partNumber: item.partNumber,
            })),
            count: items.length,
          }),
        };
      }

      case 'calculate_labor_cost': {
        const laborItems = toolInput.laborItems as Array<{ position: string; hours: number; phase?: string }>;
        const rates = await getLaborRatesByOrg(orgId);
        const rateMap = new Map(rates.map(r => [r.position, r.fullyLoadedRate]));
        
        const calculations = laborItems.map(item => {
          const rate = rateMap.get(item.position) || 0;
          const totalCost = item.hours * rate;
          return {
            position: item.position,
            hours: item.hours,
            rate,
            totalCost,
            phase: item.phase,
            found: rateMap.has(item.position),
          };
        });
        
        const totalLaborCost = calculations.reduce((sum, calc) => sum + calc.totalCost, 0);
        const byPhase = calculations.reduce((acc, calc) => {
          const phase = calc.phase || 'Base Period';
          acc[phase] = (acc[phase] || 0) + calc.totalCost;
          return acc;
        }, {} as Record<string, number>);
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            calculations,
            totalLaborCost,
            costByPhase: byPhase,
            missingRates: calculations.filter(c => !c.found).map(c => c.position),
          }),
        };
      }

      case 'analyze_competitive_position': {
        const { estimatedValue, ourPrice, contractType, naicsCode, historicalData } = toolInput;
        
        const priceDifference = ((ourPrice as number) - (estimatedValue as number)) / (estimatedValue as number) * 100;
        
        let position: 'LOW' | 'COMPETITIVE' | 'HIGH';
        if (priceDifference < -10) position = 'LOW';
        else if (priceDifference > 15) position = 'HIGH';
        else position = 'COMPETITIVE';
        
        const analysis = {
          competitivePosition: position,
          priceDifferencePercent: Math.round(priceDifference * 100) / 100,
          estimatedValue: estimatedValue as number,
          ourPrice: ourPrice as number,
          contractType: contractType as string,
          naicsCode: naicsCode as string,
          recommendations: [] as string[],
        };
        
        // Add recommendations based on position
        if (position === 'HIGH') {
          analysis.recommendations.push('Consider reducing scope or optimizing labor mix');
          analysis.recommendations.push('Review overhead and profit margins');
          analysis.recommendations.push('Explore subcontracting opportunities');
        } else if (position === 'LOW') {
          analysis.recommendations.push('Verify cost completeness - may be missing elements');
          analysis.recommendations.push('Consider increasing profit margin if justified');
        }
        
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({
            success: true,
            ...analysis,
          }),
        };
      }

      default:
        return {
          tool_use_id: toolUseId,
          content: JSON.stringify({ error: `Unknown pricing tool: ${toolName}` }),
        };
    }
  } catch (err) {
    return {
      tool_use_id: toolUseId,
      content: JSON.stringify({ 
        error: `Pricing tool error: ${(err as Error)?.message}` 
      }),
    };
  }
};
```

---

## 5. Pricing Prompts <!-- ⏳ PENDING -->

**File**: `apps/functions/src/constants/pricing-prompts.ts`

```typescript
export const usePricingSystemPrompt = async (orgId: string): Promise<string> => {
  return [
    'You analyze government solicitations to develop pricing strategies for Bid/No-Bid decisions.',
    '',
    'STRICT OUTPUT CONTRACT:',
    '- Output ONLY a single valid JSON object matching PricingSection schema',
    '- First character MUST be "{", last character MUST be "}"',
    '- No prose, markdown, or commentary outside the JSON',
    '',
    'PRICING ANALYSIS FOCUS:',
    '- Extract estimated contract value and period of performance',
    '- Identify labor categories and skill requirements from solicitation',
    '- Analyze evaluation criteria related to pricing (cost/price evaluation factors)',
    '- Assess competitive landscape and incumbent advantages',
    '- Determine appropriate pricing strategy based on contract type',
    '',
    'TOOLS AVAILABLE:',
    '- get_labor_rates: Get your organization\'s current labor rates',
    '- get_bom_items: Get bill of materials items by category',
    '- calculate_labor_cost: Calculate total labor costs for staffing plan',
    '',
    'COMPETITIVE POSITION ASSESSMENT:',
    '- LOW: Significantly below market/competitors (high win probability)',
    '- COMPETITIVE: Within market range (moderate win probability)', 
    '- HIGH: Above market/competitors (low win probability, needs justification)',
    '',
    'PRICING CONFIDENCE FACTORS:',
    '- Historical data availability (past similar contracts)',
    '- Labor rate competitiveness vs market',
    '- Completeness of requirements understanding',
    '- Subcontractor pricing certainty',
    '- Risk assessment accuracy',
  ].join('\n');
};

export const usePricingUserPrompt = async (
  orgId: string,
  solicitationText: string,
  requirementsContext: string,
  kbContext: string,
): Promise<string> => {
  return [
    'TASK: Analyze this government solicitation to develop a pricing strategy and cost estimate.',
    '',
    'REQUIRED JSON OUTPUT (copy this structure):',
    '{',
    '  "strategy": "COST_PLUS|FIXED_PRICE|TIME_AND_MATERIALS|COMPETITIVE_ANALYSIS",',
    '  "totalPrice": 0,',
    '  "competitivePosition": "LOW|COMPETITIVE|HIGH",',
    '  "priceConfidence": 85,',
    '  "laborCostTotal": 0,',
    '  "materialCostTotal": 0,',
    '  "indirectCostTotal": 0,',
    '  "profitMargin": 10,',
    '  "competitiveAdvantages": ["advantage1", "advantage2"],',
    '  "pricingRisks": ["risk1", "risk2"],',
    '  "recommendedActions": ["action1", "action2"],',
    '  "basisOfEstimate": "Detailed explanation of cost estimation methodology",',
    '  "assumptions": ["assumption1", "assumption2"]',
    '}',
    '',
    'ANALYSIS STEPS:',
    '1. Use extract_contract_value tool to get government estimated value',
    '2. Use extract_labor_requirements tool to identify staffing needs',
    '3. Use get_labor_rates tool to understand your organization\'s current rates',
    '4. Use calculate_labor_cost tool to estimate total labor costs',
    '5. Use extract_material_requirements tool for hardware/software needs',
    '6. Use get_bom_items tool to price materials and equipment',
    '7. Use search_historical_pricing tool for competitive intelligence',
    '8. Use analyze_competitive_position tool to assess win probability',
    '9. Determine appropriate pricing strategy based on contract type and competition',
    '',
    'REQUIREMENTS CONTEXT:',
    requirementsContext || '[No requirements context available]',
    '',
    'COMPANY KNOWLEDGE BASE:',
    kbContext || '[No KB context available]',
    '',
    'SOLICITATION TEXT:',
    solicitationText,
  ].join('\n');
};
```

---

## 6. Backend Lambda Handlers <!-- ⏳ PENDING -->

### Pricing Management Handlers

**File**: `apps/functions/src/handlers/pricing/create-labor-rate.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { CreateLaborRateSchema, type CreateLaborRate, type LaborRate } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { nowIso } from '@/helpers/date';
import { createLaborRate, calculateFullyLoadedRate } from '@/helpers/pricing';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  auditMiddleware,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const rawBody = JSON.parse(event.body || '{}');
    const { success, data, error } = CreateLaborRateSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
    }

    const dto: CreateLaborRate = data;
    const userId = event.authContext?.userId || 'unknown';
    const now = nowIso();

    // Calculate fully loaded rate
    const fullyLoadedRate = calculateFullyLoadedRate(dto.baseRate, dto.overhead, dto.ga, dto.profit);

    const laborRate: LaborRate = {
      ...dto,
      laborRateId: uuidv4(),
      fullyLoadedRate,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const result = await createLaborRate(laborRate);

    return apiResponse(201, { laborRate: result });
  } catch (err: unknown) {
    console.error('Error in createLaborRate handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('pricing:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware())
);
```

**File**: `apps/functions/src/handlers/pricing/calculate-estimate.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { 
  CalculateEstimateRequestSchema, 
  type CalculateEstimateRequest,
  type CostEstimate,
  type EstimateItem 
} from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { nowIso } from '@/helpers/date';
import { 
  createCostEstimate, 
  getLaborRatesByOrg, 
  getBOMItemsByOrg,
  calculateEstimateTotals 
} from '@/helpers/pricing';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  auditMiddleware,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const rawBody = JSON.parse(event.body || '{}');
    const { success, data, error } = CalculateEstimateRequestSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
    }

    const dto: CalculateEstimateRequest = data;
    const userId = event.authContext?.userId || 'unknown';
    const now = nowIso();

    // Get labor rates for calculation
    const laborRates = await getLaborRatesByOrg(dto.orgId);
    const rateMap = new Map(laborRates.map(r => [r.position, r.fullyLoadedRate]));

    // Calculate labor costs
    const laborCosts: EstimateItem[] = dto.laborItems.map(item => {
      const rate = rateMap.get(item.position) || 0;
      const totalCost = item.hours * rate;
      return {
        category: 'LABOR',
        name: item.position,
        quantity: item.hours,
        unitCost: rate,
        totalCost,
      };
    });

    // Calculate BOM costs if provided
    const materialCosts: EstimateItem[] = [];
    if (dto.bomItems?.length) {
      const bomItems = await getBOMItemsByOrg(dto.orgId);
      const bomMap = new Map(bomItems.map(b => [b.bomItemId, b]));
      
      for (const bomRef of dto.bomItems) {
        const bomItem = bomMap.get(bomRef.bomItemId);
        if (bomItem) {
          materialCosts.push({
            category: bomItem.category as 'HARDWARE' | 'SOFTWARE' | 'MATERIALS' | 'SUBCONTRACTOR' | 'TRAVEL' | 'ODC',
            name: bomItem.name,
            quantity: bomRef.quantity,
            unitCost: bomItem.unitCost,
            totalCost: bomRef.quantity * bomItem.unitCost,
          });
        }
      }
    }

    // Calculate totals (10% default margin for estimates)
    const totals = calculateEstimateTotals(
      laborCosts,
      materialCosts,
      [], // travel
      [], // subcontractor  
      [], // odc
      10  // 10% margin
    );

    const estimate: CostEstimate = {
      estimateId: uuidv4(),
      orgId: dto.orgId,
      projectId: dto.projectId,
      opportunityId: dto.opportunityId,
      name: `Estimate for ${dto.projectId}`,
      strategy: dto.strategy,
      laborCosts,
      materialCosts,
      travelCosts: [],
      subcontractorCosts: [],
      odcCosts: [],
      ...totals,
      margin: 10,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const result = await createCostEstimate(estimate);

    return apiResponse(201, { estimate: result });
  } catch (err: unknown) {
    console.error('Error in calculateEstimate handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('pricing:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware())
);
```

### Brief Pricing Handler

**File**: `apps/functions/src/handlers/brief/generate-pricing.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { withSentryLambda } from '@/sentry-lambda';
import { makeEnqueueHandler } from '@/helpers/executive-brief-queue';

export const baseHandler =
  makeEnqueueHandler('pricing') as (e: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

export const handler = withSentryLambda(baseHandler);
```

---

## 7. Frontend Integration <!-- ⏳ PENDING -->

### Executive Brief UI Updates

**File**: `apps/web/components/brief/components/PricingCard.tsx`

```typescript
'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DollarSign, TrendingUp, TrendingDown, Minus, Calculator } from 'lucide-react';
import type { PricingSection } from '@auto-rfp/core';

interface PricingCardProps {
  pricing?: PricingSection | null;
}

const getPositionIcon = (position: string) => {
  switch (position) {
    case 'LOW': return <TrendingDown className="h-4 w-4 text-green-500" />;
    case 'HIGH': return <TrendingUp className="h-4 w-4 text-red-500" />;
    default: return <Minus className="h-4 w-4 text-yellow-500" />;
  }
};

const getPositionColor = (position: string) => {
  switch (position) {
    case 'LOW': return 'bg-green-50 text-green-700 border-green-200';
    case 'HIGH': return 'bg-red-50 text-red-700 border-red-200';
    default: return 'bg-yellow-50 text-yellow-700 border-yellow-200';
  }
};

export const PricingCard = ({ pricing }: PricingCardProps) => {
  if (!pricing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Pricing Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Pricing analysis will be available after requirements are complete.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Pricing Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Price Summary */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Total Price</p>
            <p className="text-2xl font-bold">${pricing.totalPrice.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Strategy</p>
            <Badge variant="outline" className="mt-1">
              {pricing.strategy.replace(/_/g, ' ')}
            </Badge>
          </div>
        </div>

        {/* Competitive Position */}
        <div className="flex items-center justify-between p-3 rounded-lg border">
          <div className="flex items-center gap-2">
            {getPositionIcon(pricing.competitivePosition)}
            <span className="font-medium">Competitive Position</span>
          </div>
          <Badge className={getPositionColor(pricing.competitivePosition)}>
            {pricing.competitivePosition}
          </Badge>
        </div>

        {/* Cost Breakdown */}
        <div className="space-y-2">
          <h4 className="font-medium">Cost Breakdown</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between">
              <span>Labor:</span>
              <span>${pricing.laborCostTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Materials:</span>
              <span>${pricing.materialCostTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Indirect:</span>
              <span>${pricing.indirectCostTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Profit ({pricing.profitMargin}%):</span>
              <span>${((pricing.totalPrice - pricing.laborCostTotal - pricing.materialCostTotal - pricing.indirectCostTotal)).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Confidence */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Price Confidence</span>
          <div className="flex items-center gap-2">
            <div className="w-24 bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full" 
                style={{ width: `${pricing.priceConfidence}%` }}
              />
            </div>
            <span className="text-sm font-medium">{pricing.priceConfidence}%</span>
          </div>
        </div>

        {/* Competitive Advantages */}
        {pricing.competitiveAdvantages.length > 0 && (
          <div>
            <h4 className="font-medium text-green-700 mb-2">Competitive Advantages</h4>
            <ul className="text-sm space-y-1">
              {pricing.competitiveAdvantages.map((advantage, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-green-500 mt-1">•</span>
                  <span>{advantage}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Pricing Risks */}
        {pricing.pricingRisks.length > 0 && (
          <div>
            <h4 className="font-medium text-red-700 mb-2">Pricing Risks</h4>
            <ul className="text-sm space-y-1">
              {pricing.pricingRisks.map((risk, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-red-500 mt-1">•</span>
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Basis of Estimate */}
        <div>
          <h4 className="font-medium mb-2">Basis of Estimate</h4>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {pricing.basisOfEstimate}
          </p>
        </div>

        {/* Assumptions */}
        {pricing.assumptions.length > 0 && (
          <div>
            <h4 className="font-medium mb-2">Key Assumptions</h4>
            <ul className="text-sm space-y-1">
              {pricing.assumptions.map((assumption, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-muted-foreground mt-1">•</span>
                  <span>{assumption}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
```

### Executive Brief View Updates

**File**: `apps/web/components/brief/ExecutiveBriefView.tsx`

Add pricing section to the existing component:

```typescript
// Add to imports
import { PricingCard } from './components/PricingCard';
import { useGenerateExecutiveBriefPricing } from '@/lib/hooks/use-executive-brief';

// Add to component
const genPricing = useGenerateExecutiveBriefPricing(currentOrganization?.id);

// Add to section order
const SECTION_ORDER = ['summary', 'deadlines', 'requirements', 'contacts', 'risks', 'pricing', 'scoring'] as const;

// Add pricing icon
function sectionIcon(section: SectionKey) {
  switch (section) {
    // ... existing cases ...
    case 'pricing':
      return <DollarSign className="h-4 w-4"/>;
    // ... rest unchanged ...
  }
}

// Add pricing title
function sectionTitle(section: SectionKey) {
  switch (section) {
    // ... existing cases ...
    case 'pricing':
      return 'Pricing';
    // ... rest unchanged ...
  }
}

// Add to enqueueSection
async function enqueueSection(section: SectionKey, executiveBriefId: string) {
  switch (section) {
    // ... existing cases ...
    case 'pricing':
      return genPricing.trigger({ executiveBriefId });
    // ... rest unchanged ...
  }
}

// Add pricing data extraction
const pricing = briefItem?.sections?.pricing?.data;

// Add PricingCard to render
<PricingCard pricing={pricing} />
```

---

## 8. API Routes Registration <!-- ⏳ PENDING -->

**File**: `packages/infra/api/routes/pricing.routes.ts`

```typescript
import type { DomainRoutes } from './types';

export const pricingDomain = (): DomainRoutes => ({
  basePath: 'pricing',
  routes: [
    {
      method: 'POST',
      path: '/labor-rates',
      entry: 'handlers/pricing/create-labor-rate.ts',
      auth: 'required',
    },
    {
      method: 'GET', 
      path: '/labor-rates',
      entry: 'handlers/pricing/get-labor-rates.ts',
      auth: 'required',
    },
    {
      method: 'PUT',
      path: '/labor-rates/{id}',
      entry: 'handlers/pricing/update-labor-rate.ts', 
      auth: 'required',
    },
    {
      method: 'POST',
      path: '/bom-items',
      entry: 'handlers/pricing/create-bom-item.ts',
      auth: 'required',
    },
    {
      method: 'GET',
      path: '/bom-items',
      entry: 'handlers/pricing/get-bom-items.ts',
      auth: 'required',
    },
    {
      method: 'POST',
      path: '/calculate-estimate',
      entry: 'handlers/pricing/calculate-estimate.ts',
      auth: 'required',
    },
    {
      method: 'POST',
      path: '/generate-price-volume',
      entry: 'handlers/pricing/generate-price-volume.ts',
      auth: 'required',
    },
  ],
});
```

**File**: `packages/infra/api/api-orchestrator-stack.ts`

Add to imports and domain registration:

```typescript
// Add to imports
import { pricingDomain } from './routes/pricing.routes';

// Add to allDomains array
const allDomains: DomainRoutes[] = [
  // ... existing domains ...
  pricingDomain(),
  // ... rest unchanged ...
];

// Add to domainStackNames array
const domainStackNames = [
  // ... existing names ...
  'PricingRoutes',
  // ... rest unchanged ...
];
```

---

## 9. Permissions & RBAC <!-- ⏳ PENDING -->

**File**: `packages/core/src/schemas/user.ts`

Add pricing permissions:

```typescript
export const PRICING_PERMISSIONS = [
  'pricing:create', 'pricing:read', 'pricing:edit', 'pricing:delete', 'pricing:calculate'
] as const;

export const ALL_PERMISSIONS = [
  // ... existing permissions ...
  ...PRICING_PERMISSIONS,
  // ... rest unchanged ...
] as const;

// Update role permissions
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  ADMIN: [...ALL_PERMISSIONS],
  EDITOR: [
    // ... existing permissions ...
    'pricing:create', 'pricing:read', 'pricing:edit', 'pricing:calculate',
  ],
  BILLING: [
    // ... existing permissions ...
    'pricing:read', 'pricing:calculate',
  ],
  VIEWER: [
    // ... existing permissions ...
    'pricing:read',
  ],
  MEMBER: []
};
```

---

## 10. Frontend Pricing Management Pages <!-- ⏳ PENDING -->

### Labor Rates Management

**File**: `apps/web/app/(dashboard)/organizations/[orgId]/pricing/labor-rates/page.tsx`

```typescript
'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlusCircle, DollarSign, Calculator } from 'lucide-react';
import Link from 'next/link';
import { useLaborRates } from '@/lib/hooks/use-pricing';
import { useCurrentOrganization } from '@/context/organization-context';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

export default function LaborRatesPage() {
  const { currentOrganization } = useCurrentOrganization();
  const orgId = currentOrganization?.id;
  const { data: laborRates, isLoading, error } = useLaborRates(orgId);

  if (isLoading) {
    return <PageLoadingSkeleton variant="list" />;
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to load labor rates: {error.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Labor Rates</h1>
          <p className="text-muted-foreground">
            Manage hourly rates, overhead, and profit margins for cost estimation
          </p>
        </div>
        <Button asChild>
          <Link href={`/organizations/${orgId}/pricing/labor-rates/create`}>
            <PlusCircle className="h-4 w-4 mr-2" />
            Add Labor Rate
          </Link>
        </Button>
      </div>

      <div className="grid gap-4">
        {laborRates?.map((rate) => (
          <Card key={rate.laborRateId}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="font-medium">{rate.position}</h3>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>Base: ${rate.baseRate}/hr</span>
                    <span>Overhead: {rate.overhead}%</span>
                    <span>G&A: {rate.ga}%</span>
                    <span>Profit: {rate.profit}%</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xl font-bold">${rate.fullyLoadedRate}/hr</span>
                  </div>
                  <Badge variant={rate.isActive ? 'default' : 'secondary'}>
                    {rate.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>
              {rate.rateJustification && (
                <p className="text-sm text-muted-foreground mt-2">
                  {rate.rateJustification}
                </p>
              )}
            </CardContent>
          </Card>
        ))}

        {(!laborRates || laborRates.length === 0) && (
          <Card>
            <CardContent className="pt-6 text-center">
              <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-medium mb-2">No Labor Rates</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Set up your labor rates to enable cost estimation and pricing analysis.
              </p>
              <Button asChild>
                <Link href={`/organizations/${orgId}/pricing/labor-rates/create`}>
                  <PlusCircle className="h-4 w-4 mr-2" />
                  Add First Labor Rate
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
```

### Pricing Hooks

**File**: `apps/web/lib/hooks/use-pricing.ts`

```typescript
'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { authenticatedFetcher, postJson } from '@/lib/api';
import type { 
  LaborRate, 
  CreateLaborRate, 
  BOMItem, 
  CreateBOMItem,
  CostEstimate,
  CalculateEstimateRequest 
} from '@auto-rfp/core';

const BASE = '/pricing';

// ─── Labor Rates ───

export const useLaborRates = (orgId?: string) => {
  const url = orgId ? `${BASE}/labor-rates?orgId=${orgId}` : null;
  return useSWR<LaborRate[]>(url, authenticatedFetcher);
};

export const useCreateLaborRate = (orgId?: string) => {
  return useSWRMutation<LaborRate, Error, string, CreateLaborRate>(
    `${BASE}/labor-rates${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<LaborRate>(url, arg),
  );
};

// ─── BOM Items ───

export const useBOMItems = (orgId?: string, category?: string) => {
  const url = orgId ? `${BASE}/bom-items?orgId=${orgId}${category ? `&category=${category}` : ''}` : null;
  return useSWR<BOMItem[]>(url, authenticatedFetcher);
};

export const useCreateBOMItem = (orgId?: string) => {
  return useSWRMutation<BOMItem, Error, string, CreateBOMItem>(
    `${BASE}/bom-items${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<BOMItem>(url, arg),
  );
};

// ─── Cost Estimates ───

export const useCalculateEstimate = (orgId?: string) => {
  return useSWRMutation<CostEstimate, Error, string, CalculateEstimateRequest>(
    `${BASE}/calculate-estimate${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<CostEstimate>(url, arg),
  );
};

// ─── Executive Brief Pricing ───

export const useGenerateExecutiveBriefPricing = (orgId?: string) => {
  return useSWRMutation<{ ok: boolean }, Error, string, { executiveBriefId: string }>(
    `/brief/generate-pricing${orgId ? `?orgId=${orgId}` : ''}`,
    (url, { arg }) => postJson<{ ok: boolean }>(url, arg),
  );
};
```

---

## 11. Implementation Tickets <!-- ⏳ PENDING -->

### Sprint 1: Core Pricing Infrastructure (8 hours)

#### PR-1 · Pricing Schemas & Types (2 hours) <!-- ⏳ PENDING -->
- [ ] Create `packages/core/src/schemas/pricing.ts` with all Zod schemas
- [ ] Export from `packages/core/src/schemas/index.ts`
- [ ] Add pricing constants to `apps/functions/src/constants/pricing.ts`
- [ ] Write schema tests in `packages/core/src/schemas/pricing.test.ts`

**Files**: `pricing.ts`, `index.ts`, `constants/pricing.ts`, `pricing.test.ts`

#### PR-2 · DynamoDB Helpers & SK Builders (2 hours) <!-- ⏳ PENDING -->
- [ ] Create `apps/functions/src/helpers/pricing.ts` with SK builders and DB helpers
- [ ] Implement calculation functions (`calculateFullyLoadedRate`, `calculateEstimateTotals`)
- [ ] Write helper tests in `apps/functions/src/helpers/pricing.test.ts`

**Files**: `helpers/pricing.ts`, `helpers/pricing.test.ts`

#### PR-3 · Labor Rate Management Handlers (2 hours) <!-- ⏳ PENDING -->
- [ ] Create `apps/functions/src/handlers/pricing/create-labor-rate.ts`
- [ ] Create `apps/functions/src/handlers/pricing/get-labor-rates.ts`
- [ ] Create `apps/functions/src/handlers/pricing/update-labor-rate.ts`
- [ ] Write handler tests for all pricing handlers

**Files**: `create-labor-rate.ts`, `get-labor-rates.ts`, `update-labor-rate.ts`, `*.test.ts`

#### PR-4 · BOM & Estimate Handlers (2 hours) <!-- ⏳ PENDING -->
- [ ] Create `apps/functions/src/handlers/pricing/create-bom-item.ts`
- [ ] Create `apps/functions/src/handlers/pricing/get-bom-items.ts`
- [ ] Create `apps/functions/src/handlers/pricing/calculate-estimate.ts`
- [ ] Write handler tests

**Files**: `create-bom-item.ts`, `get-bom-items.ts`, `calculate-estimate.ts`, `*.test.ts`

### Sprint 2: Executive Brief Integration (6 hours)

#### PR-5 · Executive Brief Schema Extension (1 hour) <!-- ⏳ PENDING -->
- [ ] Add `pricing` section to `ExecutiveBriefItemSchema`
- [ ] Update `exec-brief-worker.ts` job schema to include pricing
- [ ] Add pricing to section order and prerequisites

**Files**: `executive-opportunity-brief.ts`, `exec-brief-worker.ts`

#### PR-6 · Pricing Tools & AI Integration (2 hours) <!-- ⏳ PENDING -->
- [ ] Create `apps/functions/src/helpers/pricing-tools.ts` with AI tools
- [ ] Create `apps/functions/src/constants/pricing-prompts.ts` with system/user prompts
- [ ] Add `runPricing` function to `exec-brief-worker.ts`
- [ ] Create `apps/functions/src/handlers/brief/generate-pricing.ts`

**Files**: `pricing-tools.ts`, `pricing-prompts.ts`, `generate-pricing.ts`

#### PR-7 · Frontend Pricing Components (2 hours) <!-- ⏳ PENDING -->
- [ ] Create `apps/web/components/brief/components/PricingCard.tsx`
- [ ] Update `ExecutiveBriefView.tsx` to include pricing section
- [ ] Create `apps/web/lib/hooks/use-pricing.ts` with SWR hooks
- [ ] Add pricing icon and section handling

**Files**: `PricingCard.tsx`, `ExecutiveBriefView.tsx`, `use-pricing.ts`

#### PR-8 · Pricing Management Pages (1 hour) <!-- ⏳ PENDING -->
- [ ] Create `apps/web/app/(dashboard)/organizations/[orgId]/pricing/labor-rates/page.tsx`
- [ ] Create `apps/web/app/(dashboard)/organizations/[orgId]/pricing/bom-items/page.tsx`
- [ ] Add navigation links to pricing management

**Files**: `labor-rates/page.tsx`, `bom-items/page.tsx`

### Sprint 3: Advanced Features (4 hours)

#### PR-9 · Price Volume Generation (2 hours) <!-- ⏳ PENDING -->
- [ ] Create `apps/functions/src/handlers/pricing/generate-price-volume.ts`
- [ ] Implement PDF/DOCX/Excel export functionality
- [ ] Add price volume templates with proper formatting

**Files**: `generate-price-volume.ts`, price volume templates

#### PR-10 · Competitive Analysis (2 hours) <!-- ⏳ PENDING -->
- [ ] Create `apps/functions/src/handlers/pricing/competitive-analysis.ts`
- [ ] Implement historical pricing comparison
- [ ] Add competitive positioning logic to scoring integration

**Files**: `competitive-analysis.ts`

---

## 12. RFP Document Generation Integration <!-- ⏳ PENDING -->

Pricing data must be available to RFP document generation for Price/Cost Volume documents.

**File**: `apps/functions/src/helpers/document-tools.ts`

Add pricing tools to document generation:

```typescript
// Add to DOCUMENT_TOOLS array
{
  name: 'get_pricing_data',
  description: 'Get pricing analysis and cost estimate data for the current opportunity',
  input_schema: {
    type: 'object',
    properties: {
      orgId: { type: 'string', description: 'Organization ID' },
      projectId: { type: 'string', description: 'Project ID' },
      opportunityId: { type: 'string', description: 'Opportunity ID' },
    },
    required: ['orgId', 'projectId', 'opportunityId'],
  },
},
{
  name: 'get_labor_breakdown',
  description: 'Get detailed labor breakdown with rates and hours for staffing tables',
  input_schema: {
    type: 'object',
    properties: {
      orgId: { type: 'string', description: 'Organization ID' },
      projectId: { type: 'string', description: 'Project ID' },
      opportunityId: { type: 'string', description: 'Opportunity ID' },
    },
    required: ['orgId', 'projectId', 'opportunityId'],
  },
},
```

**File**: `apps/functions/src/helpers/document-tools.ts`

Add pricing tool execution:

```typescript
// Add to executeDocumentTool function
case 'get_pricing_data': {
  const { orgId, projectId, opportunityId } = toolInput;
  
  // Get pricing section from executive brief
  const brief = await getExecutiveBriefByProjectId(projectId, opportunityId);
  const pricingData = brief?.sections?.pricing?.data;
  
  // Get detailed cost estimate
  const estimate = await getCostEstimateByOpportunity(orgId, projectId, opportunityId);
  
  return {
    tool_use_id: toolUseId,
    content: JSON.stringify({
      success: true,
      pricing: pricingData,
      estimate: estimate ? {
        strategy: estimate.strategy,
        totalPrice: estimate.totalPrice,
        laborCosts: estimate.laborCosts,
        materialCosts: estimate.materialCosts,
        margin: estimate.margin,
        competitivePosition: estimate.competitivePosition,
      } : null,
    }),
  };
}

case 'get_labor_breakdown': {
  const { orgId, projectId, opportunityId } = toolInput;
  
  const estimate = await getCostEstimateByOpportunity(orgId, projectId, opportunityId);
  const laborRates = await getLaborRatesByOrg(orgId);
  
  const laborBreakdown = estimate?.laborCosts.map(labor => {
    const rate = laborRates.find(r => r.position === labor.name);
    return {
      position: labor.name,
      hours: labor.quantity,
      baseRate: rate?.baseRate || 0,
      fullyLoadedRate: labor.unitCost,
      totalCost: labor.totalCost,
      phase: labor.phase,
      overhead: rate?.overhead || 0,
      ga: rate?.ga || 0,
      profit: rate?.profit || 0,
    };
  }) || [];
  
  return {
    tool_use_id: toolUseId,
    content: JSON.stringify({
      success: true,
      laborBreakdown,
      totalLaborCost: laborBreakdown.reduce((sum, item) => sum + item.totalCost, 0),
      count: laborBreakdown.length,
    }),
  };
}
```

---

## 13. GO/NO-GO Decision Calculation Fix <!-- ⏳ PENDING -->

**File**: `apps/functions/src/handlers/brief/exec-brief-worker.ts`

Update the scoring section to properly include pricing data and fix weighted calculation:

```typescript
// Update runScoring function to include pricing data
async function runScoring(job: Job): Promise<void> {
  const { orgId, executiveBriefId, inputHash: inputHashFromJob } = job;

  if (!orgId) throw new Error('orgId is missing in SQS job payload');

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    const projectId = brief.projectId;
    const opportunityId = brief.opportunityId as string;

    const prereq = scoringPrereqsComplete(brief);
    if (!prereq.ok) {
      const missing = (prereq as { ok: false; missing: string[] }).missing;
      throw new Error(`All sections should be ready before calling scoring. Missing: ${missing.join(', ')}`);
    }

    const sections = brief.sections as Record<string, { data?: Record<string, unknown> }>;
    const summaryData = sections?.summary?.data;
    const deadlinesData = sections?.deadlines?.data;
    const requirementsData = sections?.requirements?.data;
    const contactsData = sections?.contacts?.data;
    const risksData = sections?.risks?.data;
    const pricingData = sections?.pricing?.data; // NEW - Include pricing data
    const pastPerformanceData = sections?.pastPerformance?.data;

    if (!summaryData || !deadlinesData || !requirementsData || !contactsData || !risksData) {
      const missingData: string[] = [];
      if (!summaryData) missingData.push('summary.data');
      if (!deadlinesData) missingData.push('deadlines.data');
      if (!requirementsData) missingData.push('requirements.data');
      if (!contactsData) missingData.push('contacts.data');
      if (!risksData) missingData.push('risks.data');
      throw new Error(`Section data missing for scoring: ${missingData.join(', ')}`);
    }

    // Pricing is optional but recommended for accurate PRICING_POSITION scoring
    if (!pricingData) {
      console.warn('Pricing data not available for scoring - PRICING_POSITION criterion may be less accurate');
    }

    const inputHash =
      inputHashFromJob ||
      buildSectionInputHash({
        executiveBriefId,
        section: 'scoring',
        opportunityId,
        allTextKeys: brief.allTextKeys,
      });

    await markSectionInProgress({ executiveBriefId, section: 'scoring', inputHash });

    const { solicitationText: rawText } = await loadSolicitationForBrief(brief);
    const solicitationText = truncateText(rawText, MAX_SOLICITATION_CHARS);
    const kbPrimer = await loadKbPrimer(orgId, solicitationText, 3);

    const data = await invokeClaudeWithTools({
      modelId: BEDROCK_MODEL_ID,
      system: await useScoringSystemPrompt(orgId),
      user: await useScoringUserPrompt(
        orgId,
        solicitationText,
        JSON.stringify(summaryData),
        JSON.stringify(deadlinesData),
        JSON.stringify(requirementsData),
        JSON.stringify(contactsData),
        JSON.stringify(risksData),
        pastPerformanceData ? JSON.stringify(pastPerformanceData) : undefined,
        pricingData ? JSON.stringify(pricingData) : undefined, // NEW - Pass pricing data
        kbPrimer,
      ),
      tools: BRIEF_TOOLS,
      toolExecutor: (toolName, toolInput, toolUseId) =>
        executeBriefTool({ toolName, toolInput, toolUseId, orgId, projectId, opportunityId, executiveBriefId }),
      outputSchema: ScoringSectionSchema,
      maxTokens: 5000,
      temperature: 0.2,
      maxToolRounds: 2,
    });

    // Ensure PRICING_POSITION criterion exists and is properly weighted
    const computedComposite = weightedCompositeScore((data?.criteria ?? []) as Array<{ name?: string; score?: number }>);

    const normalized = {
      ...data,
      compositeScore: computedComposite,
      decision:
        data.decision ??
        (data.recommendation === 'NO_GO'
          ? 'NO_GO'
          : data.recommendation === 'GO'
            ? 'GO'
            : 'CONDITIONAL_GO'),
      blockers: data.blockers ?? [],
      requiredActions: data.requiredActions ?? [],
      confidenceDrivers: data.confidenceDrivers ?? [],
    };

    // ... rest of function unchanged ...
  } catch (err) {
    await markSectionFailed({ executiveBriefId, section: 'scoring', error: err });
    throw err;
  }
}

// Update prerequisites to include pricing
const scoringPrereqsComplete = (brief: ExecutiveBriefItem): { ok: true } | { ok: false; missing: string[] } => {
  const prereqs: Exclude<Section, 'scoring'>[] = ['summary', 'deadlines', 'requirements', 'contacts', 'risks', 'pricing']; // Added pricing
  const missing = prereqs.filter((s) => !isSectionDataValid(brief, s));
  return missing.length ? { ok: false, missing } : { ok: true };
};
```

---

## 14. Document Generation Tools Integration <!-- ⏳ PENDING -->

**File**: `apps/functions/src/helpers/document-prompts.ts`

Update Price/Cost Volume document prompts to use pricing tools:

```typescript
// Update buildUserPromptForDocumentType for PRICE_COST_VOLUME
case 'PRICE_COST_VOLUME':
  return [
    'Generate a comprehensive Price/Cost Volume document for this government proposal.',
    '',
    'REQUIRED SECTIONS:',
    '1. Cost Summary - Total price breakdown by major categories',
    '2. Labor Categories & Rates - Detailed staffing plan with fully loaded rates',
    '3. Other Direct Costs - Materials, travel, subcontractors, ODCs',
    '4. Basis of Estimate - Methodology and assumptions',
    '5. Price Narrative - Competitive positioning and value justification',
    '6. Cost Reasonableness - Market analysis and rate justification',
    '',
    'TOOLS AVAILABLE:',
    '- get_pricing_data: Get pricing analysis from executive brief',
    '- get_labor_breakdown: Get detailed labor rates and hours',
    '- Use these tools to populate accurate pricing tables and narratives',
    '',
    'FORMAT REQUIREMENTS:',
    '- Use HTML tables for cost breakdowns',
    '- Include CLIN-level pricing if multiple CLINs',
    '- Show base rates, overhead, G&A, and profit separately',
    '- Include escalation factors for multi-year contracts',
    '',
    // ... rest of prompt ...
  ].join('\n');
```

---

## 15. Integration with Existing PRICING_POSITION Scoring <!-- ⏳ PENDING -->

The Executive Brief scoring already includes `PRICING_POSITION` as one of the 5 criteria. The pricing section will feed data into this criterion:

**File**: `apps/functions/src/constants/prompt.ts`

Update scoring prompts to use pricing section data:

```typescript
export const useScoringUserPrompt = async (
  orgId: string,
  solicitationText: string,
  summaryData: string,
  deadlinesData: string,
  requirementsData: string,
  contactsData: string,
  risksData: string,
  pastPerformanceData?: string,
  pricingData?: string, // NEW
  kbContext?: string,
): Promise<string> => {
  return [
    // ... existing prompt content ...
    '',
    'PRICING SECTION DATA (use for PRICING_POSITION scoring):',
    pricingData || '[Pricing analysis not yet complete - score based on available information]',
    '',
    'PRICING_POSITION SCORING GUIDANCE (15% weight):',
    '- Score 5: Highly competitive pricing (LOW position) with strong cost justification and basis',
    '- Score 4: Competitive pricing with good cost basis and reasonable margins',
    '- Score 3: Market-rate pricing with adequate justification',
    '- Score 2: Above-market pricing (HIGH position) with weak justification',
    '- Score 1: Significantly overpriced or unjustified costs that likely disqualify',
    '',
    'PRICING_POSITION FACTORS:',
    '- Competitive position vs government estimate (LOW/COMPETITIVE/HIGH)',
    '- Price confidence level and basis of estimate quality',
    '- Labor rate competitiveness and justification',
    '- Historical pricing data availability',
    '- Pricing risks and mitigation strategies',
    '',
    // ... rest of existing prompt ...
  ].join('\n');
};
```

**File**: `apps/functions/src/handlers/brief/exec-brief-worker.ts`

Fix the weighted composite score calculation to ensure PRICING_POSITION is properly weighted:

```typescript
/** Weighted scoring criteria – must match the prompt instructions */
const SCORING_WEIGHTS: Record<string, number> = {
  TECHNICAL_FIT: 0.20,
  PAST_PERFORMANCE_RELEVANCE: 0.25,
  PRICING_POSITION: 0.15, // Critical for Bid/No-Bid
  STRATEGIC_ALIGNMENT: 0.25,
  INCUMBENT_RISK: 0.15,
};

const weightedCompositeScore = (criteria: Array<{ name?: string; score?: number }>): number => {
  if (!criteria.length) return 0;

  let weightedSum = 0;
  let totalWeight = 0;
  let matched = 0;

  // Ensure PRICING_POSITION criterion exists
  const hasPricingPosition = criteria.some(c => c.name === 'PRICING_POSITION');
  if (!hasPricingPosition) {
    console.warn('PRICING_POSITION criterion missing from scoring - adding default score of 3');
    criteria.push({ name: 'PRICING_POSITION', score: 3 });
  }

  for (const c of criteria) {
    const score = c.score ?? 0;
    const weight = c.name ? SCORING_WEIGHTS[c.name] : undefined;
    if (weight !== undefined) {
      weightedSum += score * weight;
      totalWeight += weight;
      matched++;
    } else {
      console.warn(`Unknown scoring criterion: ${c.name} - will not be included in weighted score`);
    }
  }

  // Require at least 4 of 5 criteria for weighted calculation
  if (matched < 4 || totalWeight === 0) {
    console.warn(`Only ${matched} criteria matched - falling back to simple average`);
    const scores = criteria.map((c) => c.score ?? 0);
    return Math.round(average(scores) * 10) / 10;
  }

  const finalScore = weightedSum / totalWeight;
  console.log(`Weighted composite score: ${finalScore} (${matched}/${criteria.length} criteria, total weight: ${totalWeight})`);
  
  return Math.round(finalScore * 10) / 10;
};
```

---

## 16. Acceptance Criteria Checklist <!-- ⏳ PENDING -->

### Core Functionality
- [ ] Labor rate management working (create, read, update, delete)
- [ ] BOM calculator implemented with categories (hardware, software, materials, etc.)
- [ ] Staffing plan builder with hours and rates
- [ ] All pricing strategies supported (cost-plus, fixed price, T&M, competitive)
- [ ] Price volume generation (PDF, DOCX, Excel formats)
- [ ] Integration with Bid/No-Bid engine via PRICING_POSITION criterion

### Executive Brief Integration  
- [ ] Pricing section appears in Executive Brief workflow
- [ ] Pricing section runs after requirements (dependency)
- [ ] Pricing data feeds into scoring section for PRICING_POSITION criterion
- [ ] PRICING_POSITION criterion properly weighted at 15% in composite score
- [ ] Pricing card displays in Executive Brief UI
- [ ] Generate pricing button works in brief controls

### RFP Document Generation Integration
- [ ] Pricing data available to document generation tools
- [ ] Price/Cost Volume documents can access labor breakdown
- [ ] Staffing tables populated with actual rates and hours
- [ ] Cost narratives include basis of estimate from pricing analysis
- [ ] Competitive positioning reflected in price justification

### Data Management
- [ ] Labor rates stored with fully loaded calculations
- [ ] BOM items categorized and searchable
- [ ] Cost estimates linked to specific opportunities
- [ ] Historical pricing data for competitive analysis
- [ ] Audit trail for all pricing operations

### Export & Integration
- [ ] Export to Excel format working
- [ ] Auto-populate price volume with estimate data
- [ ] Integration with existing document generation system
- [ ] Tested with sample RFPs and realistic data

---

## 17. Summary of New Files <!-- ⏳ PENDING -->

| File | Purpose | Status |
|---|---|---|
| `packages/core/src/schemas/pricing.ts` | Zod schemas for all pricing entities | ⏳ |
| `packages/core/src/schemas/pricing.test.ts` | Schema validation tests | ⏳ |
| `apps/functions/src/constants/pricing.ts` | PK constants for DynamoDB | ⏳ |
| `apps/functions/src/constants/pricing-prompts.ts` | AI prompts for pricing analysis | ⏳ |
| `apps/functions/src/helpers/pricing.ts` | SK builders, DB helpers, calculations | ⏳ |
| `apps/functions/src/helpers/pricing.test.ts` | Helper function tests | ⏳ |
| `apps/functions/src/helpers/pricing-tools.ts` | AI tools for pricing analysis | ⏳ |
| `apps/functions/src/handlers/pricing/create-labor-rate.ts` | Create labor rate handler | ⏳ |
| `apps/functions/src/handlers/pricing/get-labor-rates.ts` | Get labor rates handler | ⏳ |
| `apps/functions/src/handlers/pricing/update-labor-rate.ts` | Update labor rate handler | ⏳ |
| `apps/functions/src/handlers/pricing/create-bom-item.ts` | Create BOM item handler | ⏳ |
| `apps/functions/src/handlers/pricing/get-bom-items.ts` | Get BOM items handler | ⏳ |
| `apps/functions/src/handlers/pricing/calculate-estimate.ts` | Calculate cost estimate handler | ⏳ |
| `apps/functions/src/handlers/pricing/generate-price-volume.ts` | Generate price volume export | ⏳ |
| `apps/functions/src/handlers/pricing/competitive-analysis.ts` | Historical pricing analysis | ⏳ |
| `apps/functions/src/handlers/brief/generate-pricing.ts` | Brief pricing section handler | ⏳ |
| `packages/infra/api/routes/pricing.routes.ts` | API route definitions | ⏳ |
| `apps/web/lib/hooks/use-pricing.ts` | Frontend data hooks | ⏳ |
| `apps/web/components/brief/components/PricingCard.tsx` | Pricing display component | ⏳ |
| `apps/web/app/(dashboard)/organizations/[orgId]/pricing/labor-rates/page.tsx` | Labor rates management page | ⏳ |
| `apps/web/app/(dashboard)/organizations/[orgId]/pricing/bom-items/page.tsx` | BOM items management page | ⏳ |

**Total New Files**: 21 files
**Integration Points**: Executive Brief system, existing scoring criteria, RFP document generation, DynamoDB single-table design
**Dependencies**: Requires Executive Brief requirements section to be complete before pricing can run

---

## 13. Acceptance Criteria Checklist <!-- ⏳ PENDING -->

### Core Functionality
- [ ] Labor rate management working (create, read, update, delete)
- [ ] BOM calculator implemented with categories (hardware, software, materials, etc.)
- [ ] Staffing plan builder with hours and rates
- [ ] All pricing strategies supported (cost-plus, fixed price, T&M, competitive)
- [ ] Price volume generation (PDF, DOCX, Excel formats)
- [ ] Integration with Bid/No-Bid engine via PRICING_POSITION criterion

### Executive Brief Integration  
- [ ] Pricing section appears in Executive Brief workflow
- [ ] Pricing section runs after requirements (dependency)
- [ ] Pricing data feeds into scoring section for PRICING_POSITION criterion
- [ ] Pricing card displays in Executive Brief UI
- [ ] Generate pricing button works in brief controls

### Data Management
- [ ] Labor rates stored with fully loaded calculations
- [ ] BOM items categorized and searchable
- [ ] Cost estimates linked to specific opportunities
- [ ] Historical pricing data for competitive analysis
- [ ] Audit trail for all pricing operations

### Export & Integration
- [ ] Export to Excel format working
- [ ] Auto-populate price volume with estimate data
- [ ] Integration with existing document generation system
- [ ] Tested with sample RFPs and realistic data

---

## 14. Summary of New Files <!-- ⏳ PENDING -->

| File | Purpose | Status |
|---|---|---|
| `packages/core/src/schemas/pricing.ts` | Zod schemas for all pricing entities | ⏳ |
| `packages/core/src/schemas/pricing.test.ts` | Schema validation tests | ⏳ |
| `apps/functions/src/constants/pricing.ts` | PK constants for DynamoDB | ⏳ |
| `apps/functions/src/constants/pricing-prompts.ts` | AI prompts for pricing analysis | ⏳ |
| `apps/functions/src/helpers/pricing.ts` | SK builders, DB helpers, calculations | ⏳ |
| `apps/functions/src/helpers/pricing.test.ts` | Helper function tests | ⏳ |
| `apps/functions/src/helpers/pricing-tools.ts` | AI tools for pricing analysis | ⏳ |
| `apps/functions/src/handlers/pricing/create-labor-rate.ts` | Create labor rate handler | ⏳ |
| `apps/functions/src/handlers/pricing/get-labor-rates.ts` | Get labor rates handler | ⏳ |
| `apps/functions/src/handlers/pricing/update-labor-rate.ts` | Update labor rate handler | ⏳ |
| `apps/functions/src/handlers/pricing/create-bom-item.ts` | Create BOM item handler | ⏳ |
| `apps/functions/src/handlers/pricing/get-bom-items.ts` | Get BOM items handler | ⏳ |
| `apps/functions/src/handlers/pricing/calculate-estimate.ts` | Calculate cost estimate handler | ⏳ |
| `apps/functions/src/handlers/pricing/generate-price-volume.ts` | Generate price volume export | ⏳ |
| `apps/functions/src/handlers/pricing/competitive-analysis.ts` | Historical pricing analysis | ⏳ |
| `apps/functions/src/handlers/brief/generate-pricing.ts` | Brief pricing section handler | ⏳ |
| `packages/infra/api/routes/pricing.routes.ts` | API route definitions | ⏳ |
| `apps/web/lib/hooks/use-pricing.ts` | Frontend data hooks | ⏳ |
| `apps/web/components/brief/components/PricingCard.tsx` | Pricing display component | ⏳ |
| `apps/web/app/(dashboard)/organizations/[orgId]/pricing/labor-rates/page.tsx` | Labor rates management page | ⏳ |
| `apps/web/app/(dashboard)/organizations/[orgId]/pricing/bom-items/page.tsx` | BOM items management page | ⏳ |

**Total New Files**: 21 files
**Integration Points**: Executive Brief system, existing scoring criteria, DynamoDB single-table design
**Dependencies**: Requires Executive Brief requirements section to be complete before pricing can run
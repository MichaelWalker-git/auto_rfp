import { z } from 'zod';

/**
 * AI Prompts for Document Classification and Data Extraction
 * Used by the extraction worker to parse uploaded documents
 */

// ================================
// Shared Schema Helpers
// ================================

/** Coerce string prices like "$75.00" or "0.40" to numbers */
const coerceToNumber = z.preprocess((val) => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    // Remove currency symbols, commas, and whitespace
    const cleaned = val.replace(/[$,\s]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}, z.number().nullable());

// ================================
// Document Classification Schema
// ================================

export const DocumentClassificationSchema = z.object({
  category: z.enum([
    'PAST_PERFORMANCE',  // Case studies, contract summaries, CPARS reports
    'PRICING',           // Rate cards, cost proposals, BOE documents
    'CAPABILITIES',      // Company overview, certifications, team bios
    'OTHER',             // General documents
  ]),
  confidence: z.number().min(0).max(100),
  extractableEntities: z.array(z.enum([
    'PAST_PROJECT',
    'LABOR_RATE',
    'BOM_ITEM',
    'NONE',
  ])),
  reasoning: z.string().max(500),
});

export type DocumentClassification = z.infer<typeof DocumentClassificationSchema>;

export const CLASSIFICATION_SYSTEM_PROMPT = `You are an AI assistant that classifies business documents for government contracting.

Your job is to analyze document text and determine:
1. What category the document belongs to
2. How confident you are in that classification
3. What structured data can be extracted from it

CATEGORIES:
- PAST_PERFORMANCE: Case studies, project summaries, contract performance reports, CPARS reports, past performance questionnaires
- PRICING: Rate cards, labor rate sheets, cost proposals, BOE (Basis of Estimate) documents, pricing schedules, GSA schedules
- CAPABILITIES: Company overviews, capability statements, certifications, team bios, organizational charts
- OTHER: Any document that doesn't fit the above categories

EXTRACTABLE ENTITIES:
- PAST_PROJECT: If the document contains information about completed projects/contracts
- LABOR_RATE: If the document contains labor categories with hourly rates
- BOM_ITEM: If the document contains material/equipment pricing
- NONE: If no structured data can be extracted

Output ONLY valid JSON matching the schema. No prose or commentary.`;

export const createClassificationUserPrompt = (text: string): string => `Classify this document:

DOCUMENT TEXT:
${text.slice(0, 15000)}

Output JSON:
{
  "category": "PAST_PERFORMANCE|PRICING|CAPABILITIES|OTHER",
  "confidence": 0-100,
  "extractableEntities": ["PAST_PROJECT"|"LABOR_RATE"|"BOM_ITEM"|"NONE"],
  "reasoning": "Brief explanation"
}`;

// ================================
// Past Performance Extraction Schema
// ================================

export const ExtractedPastProjectSchema = z.object({
  title: z.string(),
  client: z.string(),
  contractNumber: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  value: z.number().optional().nullable(),
  description: z.string(),
  technicalApproach: z.string().optional().nullable(),
  achievements: z.array(z.string()).optional().nullable().transform(v => v ?? []),
  performanceRating: z.number().min(0).max(5).optional().nullable(),
  domain: z.string().optional().nullable(),
  technologies: z.array(z.string()).optional().nullable().transform(v => v ?? []),
  naicsCodes: z.array(z.string()).optional().nullable().transform(v => v ?? []),
  contractType: z.string().optional().nullable(),
  setAside: z.string().optional().nullable(),
  teamSize: z.union([z.number(), z.string().transform(v => v ? parseInt(v, 10) || null : null)]).optional().nullable(),
  durationMonths: z.union([z.number(), z.string().transform(v => v ? parseInt(v, 10) || null : null)]).optional().nullable(),
  clientPOC: z.object({
    name: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    organization: z.string().optional().nullable(),
  }).optional().nullable(),
  confidence: z.object({
    title: z.number().min(0).max(100).default(50),
    client: z.number().min(0).max(100).default(50),
    contractNumber: z.number().min(0).max(100).default(0),
    value: z.number().min(0).max(100).default(0),
    description: z.number().min(0).max(100).default(50),
    achievements: z.number().min(0).max(100).default(0),
    domain: z.number().min(0).max(100).default(0),
    technologies: z.number().min(0).max(100).default(0),
    overall: z.number().min(0).max(100).default(50),
  }).default({}),
});

export type ExtractedPastProject = z.infer<typeof ExtractedPastProjectSchema>;

export const PAST_PERF_EXTRACTION_SYSTEM_PROMPT = `You extract past performance and case study information from documents.

IMPORTANT: A "past performance" or "case study" document describes work performed for a client. It does NOT need to be labeled as such. Any document describing:
- A client/customer and their challenge or problem
- Work performed or solutions delivered
- Results, outcomes, or benefits achieved
...IS a past performance document and MUST be extracted.

For each distinct project/engagement in the document, extract:
- title: Project name, engagement name, or create a descriptive title from the client + work performed
- client: Customer/agency name (the organization you did work FOR)
- contractNumber: Contract number if mentioned (optional)
- startDate/endDate: Project period if mentioned (ISO format YYYY-MM-DD)
- value: Contract/project value in USD if mentioned (numeric only)
- description: What work was performed - summarize the challenge and solution (keep under 500 chars)
- technicalApproach: How the work was accomplished - technologies, methodologies, architecture (keep under 500 chars)
- achievements: Quantifiable results and metrics (e.g., "99.9% uptime", "40% cost reduction", "80% faster processing") - max 5 items
- performanceRating: CPARS rating if available (1-5)
- domain: Industry sector (Healthcare, Defense, Finance, Education, etc.)
- technologies: Technical stack, AWS services, tools used - max 10 items
- naicsCodes: NAICS codes if mentioned
- contractType: FFP, T&M, CPFF, etc. if mentioned
- setAside: Small business set-aside type if applicable
- teamSize: Number of personnel if mentioned
- durationMonths: Project duration in months if mentioned
- clientPOC: Point of contact information if available

CRITICAL RULES:
- Output MUST be a valid JSON array starting with [ and ending with ]
- Do NOT include any text before or after the JSON
- Do NOT wrap in code blocks
- NEVER respond with explanatory text - ALWAYS output valid JSON
- ALWAYS attempt extraction - even if the document lacks formal structure, extract what you can
- If the document describes ANY work done for a client with ANY results, EXTRACT IT
- Only return [] if the document truly contains NO client work description at all (e.g., a resume, a blank page, an unrelated article)
- Keep text fields concise to avoid truncation
- A single document may contain MULTIPLE projects - extract ALL of them
- Set confidence 0-100 for each field based on how clearly it was stated
- If information is missing or uncertain, omit the field or set low confidence`;

export const createPastPerfExtractionUserPrompt = (text: string): string => `Extract all past performance projects from this document:

DOCUMENT TEXT:
${text.slice(0, 30000)}

Output JSON array of projects:
[
  {
    "title": "...",
    "client": "...",
    "contractNumber": "...",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "value": 1000000,
    "description": "...",
    "technicalApproach": "...",
    "achievements": ["...", "..."],
    "performanceRating": 4,
    "domain": "...",
    "technologies": ["...", "..."],
    "naicsCodes": ["541512"],
    "contractType": "FFP",
    "setAside": "8(a)",
    "teamSize": 25,
    "durationMonths": 36,
    "clientPOC": {
      "name": "...",
      "title": "...",
      "email": "...",
      "phone": "...",
      "organization": "..."
    },
    "confidence": {
      "title": 95,
      "client": 90,
      "contractNumber": 85,
      "value": 70,
      "description": 90,
      "achievements": 80,
      "domain": 85,
      "technologies": 75,
      "overall": 82
    }
  }
]`;

// ================================
// Pricing/Labor Rate Extraction Schema
// ================================

export const ExtractedLaborRateSchema = z.object({
  position: z.string(),
  baseRate: coerceToNumber,
  fullyLoadedRate: z.number().optional().nullable(),
  overhead: z.number().optional().nullable(),
  ga: z.number().optional().nullable(),
  profit: z.number().optional().nullable(),
  rateSource: z.string().optional().nullable(),
  effectiveDate: z.string().optional().nullable(),
  expirationDate: z.string().optional().nullable(),
  // AI may return a simple number or an object for confidence
  confidence: z.union([
    z.number().min(0).max(100),
    z.object({
      position: z.number().min(0).max(100).optional().default(50),
      baseRate: z.number().min(0).max(100).optional().default(50),
      overhead: z.number().min(0).max(100).optional().default(0),
      overall: z.number().min(0).max(100).optional().default(50),
    }),
  ]).optional().default(50),
});

export type ExtractedLaborRate = z.infer<typeof ExtractedLaborRateSchema>;

export const PRICING_EXTRACTION_SYSTEM_PROMPT = `You extract labor rates and pricing information from documents.

For each labor category/position, extract:
- position: Job title/labor category (e.g., "Senior Software Engineer", "Project Manager")
- baseRate: Base hourly rate in USD (if available)
- fullyLoadedRate: Fully burdened/loaded rate in USD (if available)
- overhead: Overhead percentage (if available)
- ga: G&A percentage (if available)
- profit: Profit margin percentage (if available)
- rateSource: Source of rates (e.g., "GSA Schedule", "Market Analysis")
- effectiveDate/expirationDate: Rate validity period (ISO format YYYY-MM-DD)

IMPORTANT:
- Extract ALL labor categories found in the document
- If only fully loaded rate is given, don't estimate base rate
- Set confidence 0-100 based on how clearly rates are stated
- Currency should be USD (convert if necessary)

Output ONLY valid JSON. No prose or commentary.`;

export const createPricingExtractionUserPrompt = (text: string): string => `Extract all labor rates from this document:

DOCUMENT TEXT:
${text.slice(0, 30000)}

Output JSON array of labor rates:
[
  {
    "position": "Senior Software Engineer",
    "baseRate": 75.00,
    "fullyLoadedRate": 150.00,
    "overhead": 50,
    "ga": 10,
    "profit": 10,
    "rateSource": "GSA Schedule",
    "effectiveDate": "2024-01-01",
    "expirationDate": "2025-12-31",
    "confidence": {
      "position": 95,
      "baseRate": 90,
      "overhead": 85,
      "overall": 88
    }
  }
]`;

// ================================
// BOM Item Extraction Schema
// ================================

// Helper to normalize category values to valid enum
const BOM_CATEGORY_MAP: Record<string, 'HARDWARE' | 'SOFTWARE_LICENSE' | 'MATERIALS' | 'SUBCONTRACTOR' | 'TRAVEL' | 'ODC'> = {
  hardware: 'HARDWARE',
  software: 'SOFTWARE_LICENSE',
  software_license: 'SOFTWARE_LICENSE',
  license: 'SOFTWARE_LICENSE',
  materials: 'MATERIALS',
  material: 'MATERIALS',
  supplies: 'MATERIALS',
  services: 'ODC',
  service: 'ODC',
  subcontractor: 'SUBCONTRACTOR',
  subcontract: 'SUBCONTRACTOR',
  travel: 'TRAVEL',
  odc: 'ODC',
  other: 'ODC',
};

const coerceCategory = z.preprocess((val) => {
  if (typeof val !== 'string') return 'ODC';
  const normalized = val.toLowerCase().replace(/[\s-]/g, '_');
  return BOM_CATEGORY_MAP[normalized] ?? 'ODC';
}, z.enum(['HARDWARE', 'SOFTWARE_LICENSE', 'MATERIALS', 'SUBCONTRACTOR', 'TRAVEL', 'ODC']));

export const ExtractedBOMItemSchema = z.object({
  name: z.string().min(1), // Must have a name
  description: z.string().optional().nullable(),
  category: coerceCategory, // Flexible category matching
  unitCost: coerceToNumber.transform(v => v ?? 0), // Coerce strings, default to 0 if null
  unit: z.string().optional().nullable().default('each'),
  quantity: z.preprocess((val) => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }, z.number().optional().nullable()),
  vendor: z.string().optional().nullable(),
  partNumber: z.string().optional().nullable(),
  confidence: z.object({
    name: z.number().min(0).max(100).default(50),
    unitCost: z.number().min(0).max(100).default(50),
    category: z.number().min(0).max(100).default(50),
    overall: z.number().min(0).max(100).default(50),
  }).optional().default({}),
});

export type ExtractedBOMItem = z.infer<typeof ExtractedBOMItemSchema>;

export const BOM_EXTRACTION_SYSTEM_PROMPT = `You extract bill of materials (BOM) items from documents.

For each item, extract:
- name: Item name/title
- description: Brief description of the item (optional)
- category: One of: HARDWARE, SOFTWARE_LICENSE, MATERIALS, SUBCONTRACTOR, TRAVEL, ODC
- unitCost: Cost per unit in USD
- unit: Unit of measurement (e.g., "each", "per cubic foot", "per image", "per box", "per hour", "per month"). If the document has a "Unit" column, use that value exactly.
- quantity: Quantity if specified (optional)
- vendor: Vendor/supplier name (optional)
- partNumber: Part/SKU number (optional)

CATEGORIES:
- HARDWARE: Physical equipment, servers, laptops, network gear
- SOFTWARE_LICENSE: Software licenses, subscriptions, SaaS
- MATERIALS: Office supplies, consumables, raw materials, storage services, imaging services
- SUBCONTRACTOR: Subcontractor costs, consulting fees
- TRAVEL: Travel expenses, per diem, lodging
- ODC: Other Direct Costs that don't fit above

IMPORTANT:
- Extract ALL line items found in the document
- Prices should be in USD (convert if necessary)
- The "unit" field is critical - look for columns like "Unit", "UOM", "Measurement" and extract the exact value (e.g., "per cubic foot", "per image", "per box")
- Set confidence 0-100 based on how clearly data is stated

Output ONLY valid JSON. No prose or commentary.`;

export const createBOMExtractionUserPrompt = (text: string): string => `Extract all BOM/material items from this document:

DOCUMENT TEXT:
${text.slice(0, 30000)}

Output JSON array of BOM items:
[
  {
    "name": "Dell PowerEdge R750 Server",
    "description": "Rack-mounted server for application hosting",
    "category": "HARDWARE",
    "unitCost": 8500.00,
    "unit": "each",
    "quantity": 4,
    "vendor": "Dell Technologies",
    "partNumber": "R750-BASE-001",
    "confidence": {
      "name": 95,
      "unitCost": 90,
      "category": 95,
      "overall": 93
    }
  },
  {
    "name": "Storage",
    "description": "Document storage services",
    "category": "MATERIALS",
    "unitCost": 0.40,
    "unit": "per cubic foot",
    "confidence": {
      "name": 90,
      "unitCost": 95,
      "category": 80,
      "overall": 88
    }
  }
]`;

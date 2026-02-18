# Template Management System — Architecture & Implementation Guide

> **Version**: 1.0  
> **Date**: February 2026  
> **Status**: Proposed  
> **Priority**: P1 — Accelerates proposal generation  
> **Estimated Hours**: 10 hours  
> **Reference**: Section 6 (Stage 5 — Document Generation)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Requirements Analysis](#2-requirements-analysis)
3. [Architecture Overview](#3-architecture-overview)
4. [Data Model & Schema Design](#4-data-model--schema-design)
5. [S3 Storage Strategy](#5-s3-storage-strategy)
6. [Macro/Variable System](#6-macrovariable-system)
7. [API Layer — Lambda Functions & Routes](#7-api-layer--lambda-functions--routes)
8. [Version Control System](#8-version-control-system)
9. [Frontend Architecture](#9-frontend-architecture)
10. [Apply Template to Proposal Flow](#10-apply-template-to-proposal-flow)
11. [Agency-Specific Customization](#11-agency-specific-customization)
12. [Seed Templates](#12-seed-templates)
13. [Security & Access Control](#13-security--access-control)
14. [Implementation Roadmap](#14-implementation-roadmap)
15. [Acceptance Criteria](#15-acceptance-criteria)

---

## 1. Executive Summary

The Template Management System provides a reusable template library for different RFP proposal types and customer requirements. It accelerates proposal generation by offering pre-formatted structures with macro/variable support, version control, and agency-specific customization.

### Business Context

- Different agencies have different formatting requirements
- Reuse proven layouts and structures across proposals
- Consistency across proposals within an organization
- Faster document generation through pre-built templates

### Current State (What Exists)

| Capability | Current Implementation |
|---|---|
| Proposal Generation | `infrastructure/lambda/proposal/generate-proposal.ts` — AI-generated proposals via Bedrock |
| Proposal Schema | `shared/src/schemas/proposal.ts` — `ProposalDocument` with sections/subsections |
| Content Library | `infrastructure/lambda/content-library/` — Reusable Q&A content with versioning |
| S3 Storage | `infrastructure/lib/storage-stack.ts` — `documentsBucket` with versioning |
| DynamoDB Single Table | `partition_key` / `sort_key` pattern |
| RBAC Middleware | `infrastructure/lambda/middleware/rbac-middleware.ts` — Role-based access |
| SWR Hooks Pattern | `web-app/lib/hooks/use-content-library.ts` — SWR-based data fetching |

### Target State

A fully integrated template lifecycle: **Create Template → Define Sections → Add Macros → Publish → Apply to Proposal → Version & Iterate**

---

## 2. Requirements Analysis

### 2.1 Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | Template library with categorized templates (Technical, Management, Past Performance, Price, Executive Summary, Certifications) | P0 |
| FR-2 | CRUD operations for templates (create, read, update, delete) | P0 |
| FR-3 | Macro/variable support with placeholders (`{{company_name}}`, `{{project_title}}`, etc.) | P0 |
| FR-4 | Apply template to proposal with macro replacement | P0 |
| FR-5 | Template categories and filtering | P0 |
| FR-6 | Section-based template editor with content placeholders | P0 |
| FR-7 | Version control with change tracking | P1 |
| FR-8 | Rollback to previous versions | P1 |
| FR-9 | Version comparison (diff view) | P1 |
| FR-10 | Publish/draft workflow | P1 |
| FR-11 | Clone templates for customization | P1 |
| FR-12 | Agency-specific template customization | P1 |
| FR-13 | Template preview with sample data | P1 |
| FR-14 | Import/export templates as JSON | P2 |
| FR-15 | Share templates across organization | P2 |
| FR-16 | WYSIWYG editor for template content | P2 |
| FR-17 | Conditional sections based on template variables | P2 |

### 2.2 Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | All operations must respect RBAC permissions |
| NFR-2 | Soft-delete pattern (set `archivedAt`, never hard-delete) |
| NFR-3 | Template content stored in S3 for large payloads; metadata in DynamoDB |
| NFR-4 | Version snapshots are immutable once created |
| NFR-5 | Applied templates produce standard `ProposalDocument` schema output |

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Next.js 15)                              │
│                                                                              │
│  /organizations/[orgId]/templates/                                           │
│  ├── TemplatesContainer (main container)                                     │
│  │   ├── TemplatesHeader → search, filter, create button                     │
│  │   ├── TemplateCategoryFilter → category tabs                              │
│  │   ├── TemplateLibrary → grid of TemplateCards                             │
│  │   │   └── TemplateCard (per template)                                     │
│  │   │       ├── Preview → TemplatePreview                                   │
│  │   │       ├── Edit → EditTemplateDialog                                   │
│  │   │       ├── Clone → POST /templates/{id}/clone                          │
│  │   │       ├── Publish → POST /templates/{id}/publish                      │
│  │   │       ├── Versions → VersionHistoryPanel                              │
│  │   │       └── Delete → DELETE /templates/{id}                             │
│  │   ├── CreateTemplateDialog                                                │
│  │   │   ├── Step 1: Metadata (name, type, category, description)            │
│  │   │   ├── Step 2: Sections (add/edit/reorder sections)                    │
│  │   │   │   └── TemplateSectionEditor + MacroInserter                       │
│  │   │   └── Step 3: Styling (fonts, colors, margins)                        │
│  │   └── ApplyTemplateDialog                                                 │
│  │       ├── Template selector                                               │
│  │       ├── Macro value form (auto-populated + custom)                      │
│  │       └── Preview before apply                                            │
│  └── VersionHistoryPanel (side sheet)                                        │
│      ├── Version timeline                                                    │
│      ├── Restore button                                                      │
│      └── VersionCompareDialog (diff view)                                    │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY (REST API)                                  │
│  Base path: /templates                                                       │
│  ├── GET    /list                    → get-templates Lambda                   │
│  ├── GET    /get/{id}                → get-template Lambda                    │
│  ├── POST   /create                  → create-template Lambda                │
│  ├── PATCH  /update/{id}             → update-template Lambda                │
│  ├── DELETE /delete/{id}             → delete-template Lambda                │
│  ├── POST   /apply/{id}             → apply-template Lambda                  │
│  ├── POST   /clone/{id}             → clone-template Lambda                  │
│  ├── GET    /versions/{id}           → get-template-versions Lambda          │
│  ├── POST   /restore/{id}/{v}        → restore-template-version Lambda      │
│  ├── GET    /categories              → get-template-categories Lambda        │
│  ├── POST   /publish/{id}            → publish-template Lambda              │
│  ├── POST   /import                  → import-template Lambda               │
│  ├── GET    /export/{id}             → export-template Lambda               │
│  └── GET    /preview/{id}            → preview-template Lambda              │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌──────────┐    ┌──────────┐    ┌──────────────────┐
            │ DynamoDB  │    │    S3    │    │  Existing        │
            │ (single   │    │ (docs   │    │  Systems         │
            │  table)   │    │  bucket)│    │                  │
            │           │    │         │    │ • Proposals      │
            │ PK:       │    │ templ/  │    │ • Projects       │
            │ TEMPLATE  │    │ {orgId}/│    │ • Organizations  │
            │ SK:       │    │ {tplId}/│    │ • Opportunities  │
            │ {orgId}#  │    │ v{n}/   │    │ • Content Lib    │
            │ {tplId}   │    │ content │    └──────────────────┘
            └──────────┘    │ .json   │
                            └─────────┘
```

### Data Flow — Apply Template to Proposal

```
1. User opens ApplyTemplateDialog from proposal page
2. User selects a PUBLISHED template from the library
3. Frontend loads template details + macro definitions
4. System auto-populates system macros from project/org/opportunity data
5. User fills in custom macro values
6. User clicks "Preview" → frontend shows rendered preview
7. User clicks "Apply" → POST /templates/{id}/apply
8. Lambda loads template, resolves all macros, generates ProposalDocument
9. Lambda returns populated ProposalDocument
10. Frontend saves via existing POST /proposal/save-proposal
11. User can further edit the generated proposal
```

---

## 4. Data Model & Schema Design

### 4.1 Shared Schema

**File:** `shared/src/schemas/template.ts`

```typescript
import { z } from 'zod';

// ================================
// Enums & Constants
// ================================

export const TEMPLATE_CATEGORIES = [
  'TECHNICAL_PROPOSAL',
  'MANAGEMENT_PROPOSAL',
  'PAST_PERFORMANCE',
  'PRICE_VOLUME',
  'EXECUTIVE_SUMMARY',
  'CERTIFICATIONS',
  'CUSTOM',
] as const;

export const TemplateCategorySchema = z.enum(TEMPLATE_CATEGORIES);
export type TemplateCategory = z.infer<typeof TemplateCategorySchema>;

export const TEMPLATE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export const TemplateStatusSchema = z.enum(TEMPLATE_STATUSES);
export type TemplateStatus = z.infer<typeof TemplateStatusSchema>;

export const MACRO_TYPES = ['SYSTEM', 'CUSTOM'] as const;
export const MacroTypeSchema = z.enum(MACRO_TYPES);
export type MacroType = z.infer<typeof MacroTypeSchema>;

// ================================
// Sub-schemas
// ================================

export const MacroDefinitionSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/,
    'Macro key must be lowercase alphanumeric with underscores, starting with a letter'),
  label: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  type: MacroTypeSchema,
  dataSource: z.string().max(200).optional(),
  defaultValue: z.string().max(5000).optional(),
  required: z.boolean().default(false),
});

export type MacroDefinition = z.infer<typeof MacroDefinitionSchema>;

export const TemplateSectionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500),
  content: z.string().max(100000), // With {{macro}} placeholders
  order: z.number().int().min(0),
  pageLimit: z.number().int().min(1).optional(),
  required: z.boolean().default(true),
  description: z.string().max(1000).optional(),
  subsections: z.array(z.object({
    id: z.string().uuid(),
    title: z.string().min(1).max(500),
    content: z.string().max(50000),
    order: z.number().int().min(0),
  })).optional(),
});

export type TemplateSection = z.infer<typeof TemplateSectionSchema>;

export const StylingConfigSchema = z.object({
  fontFamily: z.string().max(200).optional(),
  fontSize: z.number().min(8).max(72).optional(),
  lineSpacing: z.number().min(1).max(3).optional(),
  margins: z.object({
    top: z.number().min(0).max(5).optional(),
    bottom: z.number().min(0).max(5).optional(),
    left: z.number().min(0).max(5).optional(),
    right: z.number().min(0).max(5).optional(),
  }).optional(),
  headerText: z.string().max(500).optional(),
  footerText: z.string().max(500).optional(),
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export type StylingConfig = z.infer<typeof StylingConfigSchema>;

export const TemplateVersionMetaSchema = z.object({
  version: z.number().int().min(1),
  createdAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  changeNotes: z.string().max(1000).optional(),
  s3ContentKey: z.string(),
  status: TemplateStatusSchema,
});

export type TemplateVersionMeta = z.infer<typeof TemplateVersionMetaSchema>;

// ================================
// Main Template Schema
// ================================

export const TemplateItemSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1).max(500),
  type: TemplateCategorySchema,
  category: TemplateCategorySchema,
  description: z.string().max(2000).optional(),

  // Template content (current version)
  sections: z.array(TemplateSectionSchema).min(1),
  macros: z.array(MacroDefinitionSchema).default([]),
  styling: StylingConfigSchema.optional(),

  // Metadata
  tags: z.array(z.string().max(50)).max(20).default([]),
  isDefault: z.boolean().default(false),
  status: TemplateStatusSchema.default('DRAFT'),

  // Version tracking
  currentVersion: z.number().int().min(1).default(1),
  versions: z.array(TemplateVersionMetaSchema).default([]),

  // Agency customization
  agencyId: z.string().max(200).optional(),
  agencyName: z.string().max(500).optional(),

  // Audit fields
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid().optional(),

  // Soft delete
  isArchived: z.boolean().default(false),
  archivedAt: z.string().datetime().nullable().optional(),

  // Usage tracking
  usageCount: z.number().int().nonnegative().default(0),
  lastUsedAt: z.string().datetime().nullable().optional(),
  usedInProjectIds: z.array(z.string().uuid()).max(200).default([]),

  // Publishing
  publishedAt: z.string().datetime().nullable().optional(),
  publishedBy: z.string().uuid().nullable().optional(),
});

export type TemplateItem = z.infer<typeof TemplateItemSchema>;

// ================================
// DTOs
// ================================

export const CreateTemplateDTOSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().min(1).max(500),
  type: TemplateCategorySchema,
  category: TemplateCategorySchema,
  description: z.string().max(2000).optional(),
  sections: z.array(TemplateSectionSchema).min(1),
  macros: z.array(MacroDefinitionSchema).optional(),
  styling: StylingConfigSchema.optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  agencyId: z.string().max(200).optional(),
  agencyName: z.string().max(500).optional(),
});

export type CreateTemplateDTO = z.infer<typeof CreateTemplateDTOSchema>;

export const UpdateTemplateDTOSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional(),
  sections: z.array(TemplateSectionSchema).min(1).optional(),
  macros: z.array(MacroDefinitionSchema).optional(),
  styling: StylingConfigSchema.optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  changeNotes: z.string().max(1000).optional(),
  agencyId: z.string().max(200).optional(),
  agencyName: z.string().max(500).optional(),
});

export type UpdateTemplateDTO = z.infer<typeof UpdateTemplateDTOSchema>;

export const ApplyTemplateDTOSchema = z.object({
  projectId: z.string().uuid(),
  customMacros: z.record(z.string(), z.string()).optional(),
  includeOptionalSections: z.boolean().default(true),
});

export type ApplyTemplateDTO = z.infer<typeof ApplyTemplateDTOSchema>;

export const CloneTemplateDTOSchema = z.object({
  orgId: z.string().uuid(),
  newName: z.string().min(1).max(500),
  agencyId: z.string().max(200).optional(),
  agencyName: z.string().max(500).optional(),
});

export type CloneTemplateDTO = z.infer<typeof CloneTemplateDTOSchema>;

export const ImportTemplateDTOSchema = z.object({
  orgId: z.string().uuid(),
  templateData: z.object({
    name: z.string().min(1).max(500),
    type: TemplateCategorySchema,
    category: TemplateCategorySchema,
    description: z.string().max(2000).optional(),
    sections: z.array(TemplateSectionSchema).min(1),
    macros: z.array(MacroDefinitionSchema).optional(),
    styling: StylingConfigSchema.optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
  }),
});

export type ImportTemplateDTO = z.infer<typeof ImportTemplateDTOSchema>;

// ================================
// Response Types
// ================================

export const TemplateListResponseSchema = z.object({
  items: z.array(TemplateItemSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export type TemplateListResponse = z.infer<typeof TemplateListResponseSchema>;

export const TemplateCategoriesResponseSchema = z.object({
  categories: z.array(z.object({
    name: TemplateCategorySchema,
    label: z.string(),
    count: z.number().int().nonnegative(),
  })),
});

export type TemplateCategoriesResponse = z.infer<typeof TemplateCategoriesResponseSchema>;

export const TemplateVersionsResponseSchema = z.object({
  versions: z.array(TemplateVersionMetaSchema),
  currentVersion: z.number().int().min(1),
});

export type TemplateVersionsResponse = z.infer<typeof TemplateVersionsResponseSchema>;

// ================================
// DynamoDB Key Helpers
// ================================

export const TEMPLATE_PK = 'TEMPLATE';

export function createTemplateSK(orgId: string, templateId: string): string {
  return `${orgId}#${templateId}`;
}

export function createGlobalTemplateSK(templateId: string): string {
  return `GLOBAL#${templateId}`;
}

export function parseTemplateSK(sk: string): { orgId: string; templateId: string } | null {
  const parts = sk.split('#');
  if (parts.length !== 2) return null;
  return { orgId: parts[0], templateId: parts[1] };
}

// ================================
// System Macro Definitions
// ================================

export const SYSTEM_MACROS: MacroDefinition[] = [
  { key: 'company_name', label: 'Company Name', description: 'Your organization name', type: 'SYSTEM', dataSource: 'organization.name', required: false },
  { key: 'project_title', label: 'Project Title', description: 'The project/proposal title', type: 'SYSTEM', dataSource: 'project.name', required: false },
  { key: 'contract_number', label: 'Contract Number', description: 'The contract or solicitation number', type: 'SYSTEM', dataSource: 'project.contractNumber', required: false },
  { key: 'submission_date', label: 'Submission Date', description: 'Proposal submission deadline', type: 'SYSTEM', dataSource: 'project.submissionDate', required: false },
  { key: 'page_limit', label: 'Page Limit', description: 'Maximum page count for the proposal', type: 'SYSTEM', dataSource: 'project.pageLimit', required: false },
  { key: 'opportunity_id', label: 'Opportunity ID', description: 'SAM.gov or agency opportunity identifier', type: 'SYSTEM', dataSource: 'opportunity.noticeId', required: false },
  { key: 'agency_name', label: 'Agency Name', description: 'The contracting agency name', type: 'SYSTEM', dataSource: 'opportunity.agencyName', required: false },
  { key: 'current_date', label: 'Current Date', description: "Today's date (auto-generated)", type: 'SYSTEM', dataSource: '_generated.currentDate', required: false },
  { key: 'proposal_title', label: 'Proposal Title', description: 'Title of the proposal being generated', type: 'SYSTEM', dataSource: 'project.proposalTitle', required: false },
];

// ================================
// Category Labels
// ================================

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  TECHNICAL_PROPOSAL: 'Technical Proposal',
  MANAGEMENT_PROPOSAL: 'Management Proposal',
  PAST_PERFORMANCE: 'Past Performance',
  PRICE_VOLUME: 'Price Volume',
  EXECUTIVE_SUMMARY: 'Executive Summary',
  CERTIFICATIONS: 'Certifications',
  CUSTOM: 'Custom',
};
```

**Export from shared index:**

```typescript
// shared/src/schemas/index.ts — add:
export * from './template';
```

### 4.2 DynamoDB Access Patterns

| Access Pattern | PK | SK | Operation |
|---|---|---|---|
| Get template by ID | `TEMPLATE` | `{orgId}#{templateId}` | GetItem |
| List all org templates | `TEMPLATE` | begins_with `{orgId}#` | Query |
| List global templates | `TEMPLATE` | begins_with `GLOBAL#` | Query |
| List by category | `TEMPLATE` | begins_with `{orgId}#` + filter | Query + FilterExpression |
| Get categories with counts | `TEMPLATE` | begins_with `{orgId}#` | Query + aggregate |

### 4.3 DynamoDB Constant

**File:** `infrastructure/constants/template.js`

```javascript
module.exports.TEMPLATE_PK = 'TEMPLATE';
```

---

## 5. S3 Storage Strategy

### 5.1 Key Structure

```
templates/
├── {orgId}/
│   └── {templateId}/
│       ├── v1/
│       │   └── content.json          # Full template content snapshot
│       ├── v2/
│       │   └── content.json
│       └── assets/
│           ├── logo.png              # Template-specific assets
│           └── header-bg.jpg
└── global/
    └── {templateId}/
        └── v1/
            └── content.json          # System default templates
```

### 5.2 Content JSON Structure

Each `content.json` stores a complete snapshot of the template at that version:

```typescript
interface TemplateVersionContent {
  sections: TemplateSection[];
  macros: MacroDefinition[];
  styling?: StylingConfig;
}
```

### 5.3 S3 Key Builder

**File:** `infrastructure/lambda/helpers/template.ts` (partial)

```typescript
export function buildTemplateS3Key(
  orgId: string,
  templateId: string,
  version: number,
): string {
  return `templates/${orgId}/${templateId}/v${version}/content.json`;
}

export function buildGlobalTemplateS3Key(
  templateId: string,
  version: number,
): string {
  return `templates/global/${templateId}/v${version}/content.json`;
}
```

---

## 6. Macro/Variable System

### 6.1 Overview

Macros are placeholders in template section content that get replaced with actual values when applying a template to a proposal. They use the `{{macro_key}}` syntax.

### 6.2 Macro Types

| Type | Source | Example | Resolution |
|---|---|---|---|
| **SYSTEM** | Auto-populated from project/org/opportunity data | `{{company_name}}` | Lambda resolves from DynamoDB records |
| **CUSTOM** | User-defined per template, filled at apply time | `{{team_lead_name}}` | User provides value in ApplyTemplateDialog |

### 6.3 System Macro Resolution

When applying a template, the `apply-template` Lambda resolves system macros by loading related records:

```typescript
async function resolveSystemMacros(
  projectId: string,
  orgId: string,
): Promise<Record<string, string>> {
  const [project, organization] = await Promise.all([
    getProjectById(projectId),
    getOrganizationById(orgId),
  ]);

  return {
    company_name: organization?.name ?? '',
    project_title: project?.name ?? '',
    contract_number: project?.contractNumber ?? '',
    submission_date: project?.submissionDate ?? '',
    page_limit: project?.pageLimit?.toString() ?? '',
    opportunity_id: project?.opportunityId ?? '',
    agency_name: project?.agencyName ?? '',
    current_date: new Date().toISOString().split('T')[0],
    proposal_title: project?.proposalTitle ?? project?.name ?? '',
  };
}
```

### 6.4 Macro Replacement Engine

```typescript
/**
 * Replace all {{macro_key}} placeholders in text with resolved values.
 * Unresolved macros are left as-is (or replaced with empty string based on config).
 */
export function replaceMacros(
  text: string,
  macroValues: Record<string, string>,
  options: { removeUnresolved?: boolean } = {},
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in macroValues) {
      return macroValues[key];
    }
    return options.removeUnresolved ? '' : match;
  });
}

/**
 * Apply macro replacement to all sections of a template.
 */
export function applyMacrosToSections(
  sections: TemplateSection[],
  macroValues: Record<string, string>,
): TemplateSection[] {
  return sections.map(section => ({
    ...section,
    title: replaceMacros(section.title, macroValues),
    content: replaceMacros(section.content, macroValues),
    subsections: section.subsections?.map(sub => ({
      ...sub,
      title: replaceMacros(sub.title, macroValues),
      content: replaceMacros(sub.content, macroValues),
    })),
  }));
}
```

### 6.5 Built-in Macro Reference

| Macro | Label | Data Source | Example Value |
|---|---|---|---|
| `{{company_name}}` | Company Name | `organization.name` | "Acme Corp" |
| `{{project_title}}` | Project Title | `project.name` | "Cloud Migration RFP" |
| `{{contract_number}}` | Contract Number | `project.contractNumber` | "W911NF-24-R-0001" |
| `{{submission_date}}` | Submission Date | `project.submissionDate` | "2026-03-15" |
| `{{page_limit}}` | Page Limit | `project.pageLimit` | "50" |
| `{{opportunity_id}}` | Opportunity ID | `opportunity.noticeId` | "SAM-2026-001" |
| `{{agency_name}}` | Agency Name | `opportunity.agencyName` | "Department of Defense" |
| `{{current_date}}` | Current Date | Generated | "2026-02-12" |
| `{{proposal_title}}` | Proposal Title | `project.proposalTitle` | "Technical Proposal for XYZ" |

---

## 7. API Layer — Lambda Functions & Routes

### 7.1 Route Definitions

**File:** `infrastructure/lib/api/routes/template.routes.ts`

```typescript
import type { DomainRoutes } from './types';

export function templateDomain(): DomainRoutes {
  return {
    basePath: 'templates',
    routes: [
      // P0 — Core CRUD
      { method: 'GET', path: 'list', entry: 'lambda/templates/get-templates.ts' },
      { method: 'GET', path: 'get/{id}', entry: 'lambda/templates/get-template.ts' },
      { method: 'POST', path: 'create', entry: 'lambda/templates/create-template.ts' },
      { method: 'PATCH', path: 'update/{id}', entry: 'lambda/templates/update-template.ts' },
      { method: 'DELETE', path: 'delete/{id}', entry: 'lambda/templates/delete-template.ts' },
      { method: 'POST', path: 'apply/{id}', entry: 'lambda/templates/apply-template.ts' },
      { method: 'GET', path: 'categories', entry: 'lambda/templates/get-template-categories.ts' },

      // P1 — Version Control & Workflow
      { method: 'POST', path: 'clone/{id}', entry: 'lambda/templates/clone-template.ts' },
      { method: 'GET', path: 'versions/{id}', entry: 'lambda/templates/get-template-versions.ts' },
      { method: 'POST', path: 'restore/{id}/{version}', entry: 'lambda/templates/restore-template-version.ts' },
      { method: 'POST', path: 'publish/{id}', entry: 'lambda/templates/publish-template.ts' },

      // P2 — Import/Export & Preview
      { method: 'POST', path: 'import', entry: 'lambda/templates/import-template.ts' },
      { method: 'GET', path: 'export/{id}', entry: 'lambda/templates/export-template.ts' },
      { method: 'GET', path: 'preview/{id}', entry: 'lambda/templates/preview-template.ts' },
    ],
  };
}
```

### 7.2 Lambda Function Directory

**Directory:** `infrastructure/lambda/templates/`

| File | Method | Permission | Description |
|---|---|---|---|
| `get-templates.ts` | GET | `template:read` | List templates with filtering by category, status, tags, search |
| `get-template.ts` | GET | `template:read` | Get single template by ID |
| `create-template.ts` | POST | `template:create` | Create new template, save v1 to S3 |
| `update-template.ts` | PATCH | `template:update` | Update template, create new version, save snapshot to S3 |
| `delete-template.ts` | DELETE | `template:delete` | Soft-delete (set `isArchived: true`, `archivedAt`) |
| `apply-template.ts` | POST | `template:apply` | Resolve macros, generate `ProposalDocument` |
| `get-template-categories.ts` | GET | `template:read` | Aggregate categories with counts |
| `clone-template.ts` | POST | `template:create` | Deep-copy template with new name |
| `get-template-versions.ts` | GET | `template:read` | Return version metadata array |
| `restore-template-version.ts` | POST | `template:update` | Load old version from S3, create new version with that content |
| `publish-template.ts` | POST | `template:publish` | Set status to PUBLISHED, set `publishedAt`/`publishedBy` |
| `import-template.ts` | POST | `template:create` | Create template from JSON payload |
| `export-template.ts` | GET | `template:read` | Return template as downloadable JSON |
| `preview-template.ts` | GET | `template:read` | Render template with sample macro values |

### 7.3 DynamoDB Helper Functions

**File:** `infrastructure/lambda/helpers/template.ts`

```typescript
import { PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './db';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';
import {
  TEMPLATE_PK,
  createTemplateSK,
  type TemplateItem,
  type TemplateVersionMeta,
} from '@auto-rfp/shared';
import { uploadToS3, loadTextFromS3 } from './s3';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

// ================================
// S3 Key Builders
// ================================

export function buildTemplateS3Key(
  orgId: string,
  templateId: string,
  version: number,
): string {
  return `templates/${orgId}/${templateId}/v${version}/content.json`;
}

// ================================
// DynamoDB Operations
// ================================

export async function putTemplate(item: TemplateItem): Promise<void> {
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      [PK_NAME]: TEMPLATE_PK,
      [SK_NAME]: createTemplateSK(item.orgId, item.id),
      ...item,
    },
  }));
}

export async function getTemplate(
  orgId: string,
  templateId: string,
): Promise<TemplateItem | null> {
  const res = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      [PK_NAME]: TEMPLATE_PK,
      [SK_NAME]: createTemplateSK(orgId, templateId),
    },
  }));
  return (res.Item as TemplateItem) ?? null;
}

export async function listTemplatesByOrg(
  orgId: string,
  options?: {
    category?: string;
    status?: string;
    excludeArchived?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<{ items: TemplateItem[]; total: number }> {
  const filterExpressions: string[] = [];
  const exprAttrNames: Record<string, string> = {
    '#pk': PK_NAME,
    '#sk': SK_NAME,
  };
  const exprAttrValues: Record<string, any> = {
    ':pk': TEMPLATE_PK,
    ':skPrefix': `${orgId}#`,
  };

  if (options?.excludeArchived !== false) {
    filterExpressions.push('(attribute_not_exists(#isArchived) OR #isArchived = :false)');
    exprAttrNames['#isArchived'] = 'isArchived';
    exprAttrValues[':false'] = false;
  }

  if (options?.category) {
    filterExpressions.push('#category = :category');
    exprAttrNames['#category'] = 'category';
    exprAttrValues[':category'] = options.category;
  }

  if (options?.status) {
    filterExpressions.push('#status = :status');
    exprAttrNames['#status'] = 'status';
    exprAttrValues[':status'] = options.status;
  }

  const res = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
    FilterExpression: filterExpressions.length > 0
      ? filterExpressions.join(' AND ')
      : undefined,
    ExpressionAttributeNames: exprAttrNames,
    ExpressionAttributeValues: exprAttrValues,
  }));

  const allItems = (res.Items as TemplateItem[]) ?? [];
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 20;
  const paged = allItems.slice(offset, offset + limit);

  return { items: paged, total: allItems.length };
}

export async function updateTemplateStatus(
  orgId: string,
  templateId: string,
  status: string,
  userId: string,
  now: string,
): Promise<void> {
  const updateExpr = status === 'PUBLISHED'
    ? 'SET #status = :status, #publishedAt = :now, #publishedBy = :userId, #updatedAt = :now'
    : 'SET #status = :status, #updatedAt = :now';

  const exprAttrNames: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
  };
  const exprAttrValues: Record<string, any> = {
    ':status': status,
    ':now': now,
  };

  if (status === 'PUBLISHED') {
    exprAttrNames['#publishedAt'] = 'publishedAt';
    exprAttrNames['#publishedBy'] = 'publishedBy';
    exprAttrValues[':userId'] = userId;
  }

  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      [PK_NAME]: TEMPLATE_PK,
      [SK_NAME]: createTemplateSK(orgId, templateId),
    },
    UpdateExpression: updateExpr,
    ExpressionAttributeNames: exprAttrNames,
    ExpressionAttributeValues: exprAttrValues,
  }));
}

// ================================
// S3 Version Operations
// ================================

export async function saveTemplateVersion(
  orgId: string,
  templateId: string,
  version: number,
  content: { sections: any[]; macros: any[]; styling?: any },
): Promise<string> {
  const s3Key = buildTemplateS3Key(orgId, templateId, version);
  await uploadToS3(
    DOCUMENTS_BUCKET,
    s3Key,
    JSON.stringify(content),
    'application/json',
  );
  return s3Key;
}

export async function loadTemplateVersion(
  orgId: string,
  templateId: string,
  version: number,
): Promise<{ sections: any[]; macros: any[]; styling?: any } | null> {
  const s3Key = buildTemplateS3Key(orgId, templateId, version);
  const text = await loadTextFromS3(DOCUMENTS_BUCKET, s3Key);
  if (!text) return null;
  return JSON.parse(text);
}

// ================================
// Macro Engine
// ================================

export function replaceMacros(
  text: string,
  macroValues: Record<string, string>,
  options: { removeUnresolved?: boolean } = {},
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in macroValues) {
      return macroValues[key];
    }
    return options.removeUnresolved ? '' : match;
  });
}
```

### 7.4 Key Lambda Implementations

#### 7.4.1 `create-template.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';
import { CreateTemplateDTOSchema, SYSTEM_MACROS } from '@auto-rfp/shared';
import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import { nowIso } from '../helpers/date';
import { putTemplate, saveTemplateVersion, buildTemplateS3Key } from '../helpers/template';

async function baseHandler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const body = JSON.parse(event.body || '');
    const { success, data, error } = CreateTemplateDTOSchema.safeParse(body);
    if (!success) {
      return apiResponse(400, { error: 'Validation failed', details: error.format() });
    }

    const orgId = data.orgId || getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const userId = (event as any).auth?.userId || 'system';
    const templateId = uuidv4();
    const now = nowIso();

    // Merge system macros with custom macros
    const allMacros = [
      ...SYSTEM_MACROS,
      ...(data.macros ?? []),
    ];

    // Save version content to S3
    const s3Key = await saveTemplateVersion(orgId, templateId, 1, {
      sections: data.sections,
      macros: allMacros,
      styling: data.styling,
    });

    const item = {
      id: templateId,
      orgId,
      name: data.name,
      type: data.type,
      category: data.category,
      description: data.description,
      sections: data.sections,
      macros: allMacros,
      styling: data.styling,
      tags: data.tags ?? [],
      isDefault: false,
      status: 'DRAFT' as const,
      currentVersion: 1,
      versions: [{
        version: 1,
        createdAt: now,
        createdBy: userId,
        changeNotes: 'Initial version',
        s3ContentKey: s3Key,
        status: 'DRAFT' as const,
      }],
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      isArchived: false,
      archivedAt: null,
      usageCount: 0,
      lastUsedAt: null,
      usedInProjectIds: [],
      publishedAt: null,
      publishedBy: null,
      agencyId: data.agencyId,
      agencyName: data.agencyName,
    };

    await putTemplate(item);
    return apiResponse(201, { data: item });
  } catch (err) {
    console.error('Error creating template:', err);
    return apiResponse(500, {
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('template:create'))
    .use(httpErrorMiddleware()),
);
```

#### 7.4.2 `apply-template.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { ApplyTemplateDTOSchema, type ProposalDocument } from '@auto-rfp/shared';
import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import { getTemplate, replaceMacros } from '../helpers/template';
import { getProjectById } from '../helpers/project';

async function resolveSystemMacros(
  projectId: string,
  orgId: string,
): Promise<Record<string, string>> {
  const project = await getProjectById(projectId);
  // Load organization data as needed

  return {
    company_name: '', // from organization
    project_title: (project as any)?.name ?? '',
    contract_number: (project as any)?.contractNumber ?? '',
    submission_date: (project as any)?.submissionDate ?? '',
    page_limit: (project as any)?.pageLimit?.toString() ?? '',
    opportunity_id: (project as any)?.opportunityId ?? '',
    agency_name: (project as any)?.agencyName ?? '',
    current_date: new Date().toISOString().split('T')[0],
    proposal_title: (project as any)?.proposalTitle ?? (project as any)?.name ?? '',
  };
}

async function baseHandler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const templateId = event.pathParameters?.id;
    if (!templateId) return apiResponse(400, { error: 'Missing template ID' });

    const body = JSON.parse(event.body || '');
    const { success, data, error } = ApplyTemplateDTOSchema.safeParse(body);
    if (!success) {
      return apiResponse(400, { error: 'Validation failed', details: error.format() });
    }

    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    // Load template
    const template = await getTemplate(orgId, templateId);
    if (!template) return apiResponse(404, { error: 'Template not found' });
    if (template.isArchived) return apiResponse(410, { error: 'Template is archived' });

    // Resolve macros
    const systemMacros = await resolveSystemMacros(data.projectId, orgId);
    const allMacros = { ...systemMacros, ...(data.customMacros ?? {}) };

    // Apply macros to sections and build ProposalDocument
    const sections = template.sections
      .filter(s => data.includeOptionalSections || s.required)
      .sort((a, b) => a.order - b.order)
      .map(section => ({
        id: section.id,
        title: replaceMacros(section.title, allMacros),
        summary: section.description
          ? replaceMacros(section.description, allMacros)
          : null,
        subsections: (section.subsections ?? [])
          .sort((a, b) => a.order - b.order)
          .map(sub => ({
            id: sub.id,
            title: replaceMacros(sub.title, allMacros),
            content: replaceMacros(sub.content, allMacros),
          })),
      }));

    // If no subsections, create one from section content
    const finalSections = sections.map(section => ({
      ...section,
      subsections: section.subsections.length > 0
        ? section.subsections
        : [{
            id: section.id + '-content',
            title: section.title,
            content: replaceMacros(
              template.sections.find(s => s.id === section.id)?.content ?? '',
              allMacros,
            ),
          }],
    }));

    const proposalDocument: ProposalDocument = {
      proposalTitle: replaceMacros(
        template.name,
        allMacros,
      ),
      customerName: allMacros.agency_name || null,
      opportunityId: allMacros.opportunity_id || null,
      outlineSummary: template.description
        ? replaceMacros(template.description, allMacros)
        : null,
      sections: finalSections,
    };

    // Track usage (fire-and-forget)
    // updateTemplateUsage(orgId, templateId, data.projectId);

    return apiResponse(200, {
      proposal: proposalDocument,
      templateId: template.id,
      templateName: template.name,
      templateVersion: template.currentVersion,
    });
  } catch (err) {
    console.error('Error applying template:', err);
    return apiResponse(500, {
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('template:apply'))
    .use(httpErrorMiddleware()),
);
```

#### 7.4.3 `get-templates.ts`

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
} from '../middleware/rbac-middleware';
import { listTemplatesByOrg } from '../helpers/template';

async function baseHandler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const params = event.queryStringParameters ?? {};
    const category = params.category;
    const status = params.status;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const offset = params.offset ? parseInt(params.offset, 10) : 0;

    const { items, total } = await listTemplatesByOrg(orgId, {
      category,
      status,
      excludeArchived: params.excludeArchived !== 'false',
      limit,
      offset,
    });

    return apiResponse(200, {
      items,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (err) {
    console.error('Error listing templates:', err);
    return apiResponse(500, {
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(httpErrorMiddleware()),
);
```

### 7.5 CDK Registration

**File:** `infrastructure/lib/api/api-orchestrator-stack.ts` — add:

```typescript
import { templateDomain } from './routes/template.routes';

// In the stack constructor, add alongside other domain stacks:
const templateRoutes = templateDomain();
// Register with ApiDomainRoutesStack
```

---

## 8. Version Control System

### 8.1 Version Lifecycle

```
CREATE template → v1 (DRAFT)
EDIT template   → v2 (DRAFT), v1 content preserved in S3
PUBLISH v2      → v2 (PUBLISHED), v1 (ARCHIVED)
EDIT again      → v3 (DRAFT), v2 (PUBLISHED)
ROLLBACK to v1  → v4 (DRAFT, content copied from v1's S3 snapshot)
```

**Key principle:** Rollback creates a NEW version with old content. History is never mutated.

### 8.2 Version Storage

| Storage | What | Why |
|---|---|---|
| DynamoDB `versions[]` array | Lightweight metadata (version number, author, date, change notes, S3 key) | Fast listing, no extra queries |
| S3 `content.json` per version | Full template content snapshot (sections, macros, styling) | Keeps DynamoDB items under 400KB limit |

### 8.3 Update Flow (Creates New Version)

```
1. User edits template in EditTemplateDialog
2. Frontend sends PATCH /templates/update/{id} with updated sections + changeNotes
3. Lambda loads current template from DynamoDB
4. Lambda increments currentVersion
5. Lambda saves new content snapshot to S3: templates/{orgId}/{id}/v{N}/content.json
6. Lambda appends new VersionMeta to versions[] array
7. Lambda updates DynamoDB record with new sections + version info
8. Lambda returns updated template
```

### 8.4 Restore Flow

```
1. User views VersionHistoryPanel, clicks "Restore" on v2
2. Frontend sends POST /templates/restore/{id}/{version}
3. Lambda loads version content from S3: templates/{orgId}/{id}/v2/content.json
4. Lambda creates NEW version (v5) with content from v2
5. Lambda saves v5 content to S3
6. Lambda updates DynamoDB with v5 as current
7. Lambda returns updated template with changeNotes: "Restored from v2"
```

### 8.5 Version Comparison

For comparing two versions, the frontend:

1. Fetches both version contents via `GET /templates/versions/{id}?v1=2&v2=5`
2. Uses a client-side JSON diff library (e.g., `deep-diff` or custom section-level diff)
3. Renders side-by-side comparison showing:
   - Added sections (green)
   - Removed sections (red)
   - Modified section content (yellow highlight with inline diff)

### 8.6 Approval Workflow

| Status | Visibility | Who Can Set |
|---|---|---|
| `DRAFT` | Creator + Admins only | Anyone with `template:create` |
| `PUBLISHED` | All org members | Admins/Editors with `template:publish` |
| `ARCHIVED` | Hidden (unless explicitly shown) | Admins with `template:delete` |

**State transitions:**

```
DRAFT → PUBLISHED (via publish endpoint)
PUBLISHED → DRAFT (via unpublish / new edit creates draft version)
DRAFT → ARCHIVED (via delete endpoint)
PUBLISHED → ARCHIVED (via delete endpoint)
ARCHIVED → DRAFT (via restore)
```

---

## 9. Frontend Architecture

### 9.1 Page Structure

**File:** `web-app/app/organizations/[orgId]/templates/page.tsx`

```tsx
import { TemplatesContainer } from '@/components/templates/TemplatesContainer';

interface TemplatesPageProps {
  params: Promise<{ orgId: string }>;
}

export default async function TemplatesPage({ params }: TemplatesPageProps) {
  const { orgId } = await params;
  return <TemplatesContainer orgId={orgId} />;
}
```

### 9.2 Component Directory

**Directory:** `web-app/components/templates/`

| Component | Description | Shadcn UI Components |
|---|---|---|
| `TemplatesContainer.tsx` | Main container with state, filters, dialogs | `Card` |
| `TemplatesHeader.tsx` | Title, search input, category filter, create button | `Input`, `Select`, `Button` |
| `TemplateCategoryFilter.tsx` | Horizontal tabs for category filtering | `Tabs`, `TabsList`, `TabsTrigger`, `Badge` |
| `TemplateLibrary.tsx` | Grid layout of TemplateCards | CSS Grid |
| `TemplateCard.tsx` | Single template card with preview + actions | `Card`, `Badge`, `DropdownMenu`, `Button` |
| `CreateTemplateDialog.tsx` | Multi-step creation wizard | `Dialog`, `Tabs`, `Input`, `Textarea`, `Select` |
| `EditTemplateDialog.tsx` | Full template editor | `Dialog`, `Tabs`, `Input`, `Textarea` |
| `TemplateSectionEditor.tsx` | Editor for a single section with macro support | `Textarea`, `Button`, `Popover` |
| `MacroInserter.tsx` | Dropdown to insert macro placeholders | `Popover`, `Command`, `CommandInput`, `CommandItem` |
| `TemplatePreview.tsx` | Live preview with sample data | `Card`, `ScrollArea` |
| `ApplyTemplateDialog.tsx` | Select template + fill macros + preview + apply | `Dialog`, `Select`, `Input`, `Button` |
| `VersionHistoryPanel.tsx` | Side sheet with version timeline | `Sheet`, `ScrollArea`, `Button` |
| `VersionCompareDialog.tsx` | Side-by-side diff view | `Dialog`, `ScrollArea` |
| `TemplateActionsDropdown.tsx` | Clone, publish, archive, export actions | `DropdownMenu` |
| `DeleteTemplateDialog.tsx` | Confirmation dialog for archiving | `AlertDialog` |
| `ImportTemplateDialog.tsx` | Import from JSON file | `Dialog`, `Input` (file) |
| `index.ts` | Barrel exports | — |

### 9.3 SWR Hooks

**File:** `web-app/lib/hooks/use-templates.ts`

```typescript
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';

const API_BASE = `${env.BASE_API_URL}/templates`;

async function fetcher(url: string) {
  const res = await authFetcher(url, { method: 'GET' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch');
  }
  return res.json();
}

async function mutationFetcher(
  url: string,
  { arg }: { arg: { method: string; body?: unknown } },
) {
  const res = await authFetcher(url, {
    method: arg.method,
    body: arg.body ? JSON.stringify(arg.body) : undefined,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch');
  }
  return res.json();
}

// ---- List Templates ----
export function useTemplates(params: {
  orgId: string;
  category?: string;
  status?: string;
  limit?: number;
  offset?: number;
} | null) {
  const entries: Array<[string, string]> = [];
  if (params) {
    entries.push(['orgId', params.orgId]);
    if (params.category) entries.push(['category', params.category]);
    if (params.status) entries.push(['status', params.status]);
    if (params.limit) entries.push(['limit', String(params.limit)]);
    if (params.offset) entries.push(['offset', String(params.offset)]);
  }
  const qs = params ? new URLSearchParams(entries).toString() : null;

  const { data, error, isLoading, mutate } = useSWR(
    params ? `${API_BASE}/list?${qs}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 },
  );

  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    hasMore: data?.hasMore ?? false,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

// ---- Get Single Template ----
export function useTemplate(orgId: string | null, templateId: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    orgId && templateId
      ? `${API_BASE}/get/${templateId}?orgId=${orgId}`
      : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  return { template: data, isLoading, isError: !!error, error, mutate };
}

// ---- Create Template ----
export function useCreateTemplate() {
  const { trigger, isMutating, error } = useSWRMutation(
    `${API_BASE}/create`,
    mutationFetcher,
  );
  const create = async (data: any) => trigger({ method: 'POST', body: data });
  return { create, isCreating: isMutating, error };
}

// ---- Update Template ----
export function useUpdateTemplate(orgId: string, templateId: string) {
  const { trigger, isMutating, error } = useSWRMutation(
    `${API_BASE}/update/${templateId}?orgId=${orgId}`,
    mutationFetcher,
  );
  const update = async (data: any) => trigger({ method: 'PATCH', body: data });
  return { update, isUpdating: isMutating, error };
}

// ---- Delete Template ----
export function useDeleteTemplate(orgId: string, templateId: string) {
  const deleteTemplate = async () => {
    const res = await authFetcher(
      `${API_BASE}/delete/${templateId}?orgId=${orgId}`,
      { method: 'DELETE' },
    );
    if (!res.ok) throw new Error('Failed to delete template');
    return res.json();
  };
  return { deleteTemplate };
}

// ---- Apply Template ----
export function useApplyTemplate(orgId: string) {
  const apply = async (templateId: string, body: any) => {
    const res = await authFetcher(
      `${API_BASE}/apply/${templateId}?orgId=${orgId}`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (!res.ok) throw new Error('Failed to apply template');
    return res.json();
  };
  return { apply };
}

// ---- Clone Template ----
export function useCloneTemplate(orgId: string) {
  const clone = async (templateId: string, body: any) => {
    const res = await authFetcher(
      `${API_BASE}/clone/${templateId}?orgId=${orgId}`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (!res.ok) throw new Error('Failed to clone template');
    return res.json();
  };
  return { clone };
}

// ---- Template Versions ----
export function useTemplateVersions(orgId: string | null, templateId: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    orgId && templateId
      ? `${API_BASE}/versions/${templateId}?orgId=${orgId}`
      : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  return {
    versions: data?.versions ?? [],
    currentVersion: data?.currentVersion ?? 1,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

// ---- Publish Template ----
export function usePublishTemplate(orgId: string) {
  const publish = async (templateId: string) => {
    const res = await authFetcher(
      `${API_BASE}/publish/${templateId}?orgId=${orgId}`,
      { method: 'POST' },
    );
    if (!res.ok) throw new Error('Failed to publish template');
    return res.json();
  };
  return { publish };
}

// ---- Template Categories ----
export function useTemplateCategories(orgId: string | null) {
  const { data, error, isLoading } = useSWR(
    orgId ? `${API_BASE}/categories?orgId=${orgId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  );
  return { categories: data?.categories ?? [], isLoading, isError: !!error, error };
}
```

### 9.4 Editor Technology Decision

For the template section editor (MVP), use a **structured textarea approach** with macro insertion:

| Option | Library | Verdict |
|---|---|---|
| **Textarea + MacroInserter** | Native `<textarea>` + Shadcn `Popover`/`Command` | ✅ **MVP** — Simple, fast, no extra deps |
| **Tiptap** | `@tiptap/react` | ⚠️ P2 — Full rich text, custom extensions for macros |
| **Plate** | `@udecode/plate` | ⚠️ P2 — Shadcn-compatible rich text editor |
| **MDX Editor** | `@mdxeditor/editor` | ❌ Overkill for this use case |

**MVP approach:** Each section has a `<Textarea>` for content. A `MacroInserter` button opens a `Command` palette listing available macros. Clicking a macro inserts `{{macro_key}}` at the cursor position.

### 9.5 Navigation Integration

Add "Templates" to the sidebar navigation:

**File:** `web-app/components/nav-main.tsx` — add entry:

```typescript
{
  title: 'Templates',
  url: `/organizations/${orgId}/templates`,
  icon: LayoutTemplate, // from lucide-react
}
```

---

## 10. Apply Template to Proposal Flow

### 10.1 Integration with Existing Proposal System

The `apply-template` Lambda outputs a `ProposalDocument` that matches the existing `ProposalDocumentSchema` from `shared/src/schemas/proposal.ts`. This means:

1. The output can be directly saved via the existing `save-proposal` Lambda
2. The output can be displayed in the existing proposal editor UI
3. Users can further edit the generated proposal after applying a template

### 10.2 Detailed Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Proposal Page   │────▶│ ApplyTemplate    │────▶│ Template        │
│  "Use Template"  │     │ Dialog           │     │ Selection       │
│  button          │     │                  │     │ (PUBLISHED only)│
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                           │
                         ┌──────────────────┐              │
                         │ Macro Value Form │◀─────────────┘
                         │                  │
                         │ System macros:   │
                         │ ✅ auto-filled   │
                         │                  │
                         │ Custom macros:   │
                         │ 📝 user fills    │
                         └────────┬─────────┘
                                  │
                         ┌────────▼─────────┐
                         │ Preview Panel    │
                         │ (rendered with   │
                         │  macro values)   │
                         └────────┬─────────┘
                                  │ "Apply"
                         ┌────────▼─────────┐
                         │ POST /templates/ │
                         │ apply/{id}       │
                         │                  │
                         │ Returns:         │
                         │ ProposalDocument │
                         └────────┬─────────┘
                                  │
                         ┌────────▼─────────┐
                         │ POST /proposal/  │
                         │ save-proposal    │
                         │                  │
                         │ Saves to DB      │
                         └────────┬─────────┘
                                  │
                         ┌────────▼─────────┐
                         │ Proposal Editor  │
                         │ (user can edit)  │
                         └─────────────────┘
```

### 10.3 ApplyTemplateDialog Component

The `ApplyTemplateDialog` is accessible from two places:

1. **Templates page** — "Apply" action on a template card
2. **Proposal page** — "Use Template" button in the proposal editor

```tsx
// Key props
interface ApplyTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  projectId: string;
  preselectedTemplateId?: string; // When opened from template card
  onApplied: (proposal: ProposalDocument) => void;
}
```

---

## 11. Agency-Specific Customization

### 11.1 How It Works

Templates can be customized per agency through:

1. **Agency fields** on the template: `agencyId` and `agencyName`
2. **Clone + customize** workflow: Clone a base template, set agency fields, customize sections
3. **Filtering**: List templates filtered by `agencyId`

### 11.2 Agency Template Workflow

```
1. Admin creates base "Technical Proposal" template
2. Admin publishes it as org-wide default
3. For a DoD opportunity, user clones the template
4. User sets agencyId: "DOD", agencyName: "Department of Defense"
5. User customizes sections for DoD-specific requirements (e.g., CDRL, SOW format)
6. User publishes the DoD-specific template
7. Next DoD opportunity → user selects the DoD template directly
```

### 11.3 Saved Preferences

Agency preferences are stored on the template itself:

- `agencyId` — Machine-readable identifier
- `agencyName` — Human-readable name
- `styling` — Agency-specific formatting (fonts, margins, colors)
- `sections` — Agency-specific section structure

### 11.4 Branding Variations

The `StylingConfig` supports per-agency branding:

```typescript
// DoD template styling
{
  fontFamily: 'Times New Roman',
  fontSize: 12,
  lineSpacing: 1.5,
  margins: { top: 1, bottom: 1, left: 1, right: 1 },
  headerText: 'UNCLASSIFIED',
  footerText: 'Page {{page_number}} of {{total_pages}}',
}

// GSA template styling
{
  fontFamily: 'Arial',
  fontSize: 11,
  lineSpacing: 1.15,
  margins: { top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 },
}
```

---

## 12. Seed Templates

### 12.1 Default Templates to Create

The system should be seeded with 6 default templates that cover common RFP proposal types:

#### Template 1: Technical Proposal

```json
{
  "name": "Technical Proposal",
  "type": "TECHNICAL_PROPOSAL",
  "category": "TECHNICAL_PROPOSAL",
  "description": "Standard technical proposal template for government RFPs",
  "sections": [
    {
      "title": "Technical Approach",
      "content": "{{company_name}} proposes the following technical approach for {{project_title}}...",
      "order": 0,
      "required": true,
      "description": "Describe your technical methodology and approach"
    },
    {
      "title": "Understanding of Requirements",
      "content": "Our team has thoroughly analyzed the requirements outlined in solicitation {{contract_number}}...",
      "order": 1,
      "required": true
    },
    {
      "title": "Work Breakdown Structure",
      "content": "The following WBS outlines the major tasks and deliverables...",
      "order": 2,
      "required": true
    },
    {
      "title": "Schedule and Milestones",
      "content": "The proposed schedule aligns with the submission deadline of {{submission_date}}...",
      "order": 3,
      "required": true
    },
    {
      "title": "Risk Management",
      "content": "{{company_name}} has identified the following risks and mitigation strategies...",
      "order": 4,
      "required": false
    },
    {
      "title": "Quality Assurance",
      "content": "Our quality assurance plan ensures all deliverables meet {{agency_name}} standards...",
      "order": 5,
      "required": false
    }
  ]
}
```

#### Template 2: Management Proposal

- Sections: Organizational Structure, Key Personnel, Staffing Plan, Communication Plan, Transition Plan, Subcontractor Management

#### Template 3: Past Performance Volume

- Sections: Past Performance Summary, Contract References (×3), Relevance Matrix, Lessons Learned

#### Template 4: Price/Cost Volume

- Sections: Pricing Summary, Labor Categories & Rates, Other Direct Costs, Basis of Estimate, Price Narrative

#### Template 5: Executive Summary

- Sections: Company Overview, Solution Summary, Key Differentiators, Team Qualifications, Value Proposition

#### Template 6: Certifications & Representations

- Sections: Company Certifications, Small Business Status, Organizational Conflicts of Interest, Required Representations

### 12.2 Seeding Strategy

Create a seed script that can be run during deployment or manually:

**File:** `infrastructure/lambda/templates/seed-templates.ts`

This Lambda can be invoked manually or as part of a CDK custom resource to populate default templates for new organizations.

---

## 13. Security & Access Control

### 13.1 RBAC Permissions

| Permission | Description | Roles |
|---|---|---|
| `template:create` | Create new templates | ADMIN, EDITOR |
| `template:read` | View templates | ADMIN, EDITOR, VIEWER |
| `template:update` | Edit templates | ADMIN, EDITOR |
| `template:delete` | Archive templates | ADMIN |
| `template:publish` | Publish templates for org use | ADMIN, EDITOR |
| `template:apply` | Apply templates to proposals | ADMIN, EDITOR |

### 13.2 Data Isolation

- Templates are scoped to `orgId` — users can only access templates belonging to their organization
- The `orgId` is extracted from the JWT token via `getOrgId(event)`
- All DynamoDB queries use `orgId` as part of the sort key prefix

### 13.3 Soft Delete

- Templates are never hard-deleted
- `DELETE` endpoint sets `isArchived: true` and `archivedAt: <timestamp>`
- Archived templates are excluded from list queries by default
- Archived templates cannot be applied to proposals

### 13.4 Input Validation

- All request bodies validated with Zod schemas
- Macro keys validated with regex: `^[a-z][a-z0-9_]*$`
- Section content limited to 100KB per section
- Template names limited to 500 characters
- Tags limited to 20 per template

---

## 14. Implementation Roadmap

### Phase 1 — Core Backend (4 hours)

| Task | Time | Deliverable |
|---|---|---|
| Shared schema (`shared/src/schemas/template.ts`) | 0.5h | Zod schemas, types, constants, key helpers |
| Export from shared index | 0.1h | `shared/src/schemas/index.ts` update |
| DynamoDB constant | 0.1h | `infrastructure/constants/template.js` |
| DynamoDB helper functions | 0.5h | `infrastructure/lambda/helpers/template.ts` |
| Create template Lambda | 0.5h | `infrastructure/lambda/templates/create-template.ts` |
| Get template Lambda | 0.3h | `infrastructure/lambda/templates/get-template.ts` |
| List templates Lambda | 0.3h | `infrastructure/lambda/templates/get-templates.ts` |
| Update template Lambda | 0.5h | `infrastructure/lambda/templates/update-template.ts` |
| Delete template Lambda | 0.3h | `infrastructure/lambda/templates/delete-template.ts` |
| API routes definition | 0.3h | `infrastructure/lib/api/routes/template.routes.ts` |
| CDK orchestrator registration | 0.3h | `infrastructure/lib/api/api-orchestrator-stack.ts` update |
| Categories Lambda | 0.3h | `infrastructure/lambda/templates/get-template-categories.ts` |

### Phase 2 — Apply Template & Macros (2 hours)

| Task | Time | Deliverable |
|---|---|---|
| Apply template Lambda | 1.0h | `infrastructure/lambda/templates/apply-template.ts` |
| Macro resolution engine | 0.5h | System macro resolution + replacement in `helpers/template.ts` |
| Integration with ProposalDocument schema | 0.5h | Output mapping to existing proposal structure |

### Phase 3 — Frontend (3 hours)

| Task | Time | Deliverable |
|---|---|---|
| SWR hooks | 0.5h | `web-app/lib/hooks/use-templates.ts` |
| Templates page + container | 0.3h | `web-app/app/organizations/[orgId]/templates/page.tsx` + `TemplatesContainer.tsx` |
| Template card + library grid | 0.3h | `TemplateCard.tsx`, `TemplateLibrary.tsx` |
| Category filter tabs | 0.2h | `TemplateCategoryFilter.tsx` |
| Create template dialog | 0.5h | `CreateTemplateDialog.tsx` with section editor |
| Section editor + macro inserter | 0.3h | `TemplateSectionEditor.tsx`, `MacroInserter.tsx` |
| Apply template dialog | 0.5h | `ApplyTemplateDialog.tsx` with macro form + preview |
| Navigation integration | 0.1h | Add "Templates" to sidebar |
| Template actions dropdown | 0.2h | `TemplateActionsDropdown.tsx` |
| Delete confirmation dialog | 0.1h | `DeleteTemplateDialog.tsx` |

### Phase 4 — Version Control & Polish (1 hour)

| Task | Time | Deliverable |
|---|---|---|
| Version history Lambda | 0.2h | `get-template-versions.ts` |
| Restore version Lambda | 0.3h | `restore-template-version.ts` |
| Clone template Lambda | 0.2h | `clone-template.ts` |
| Publish template Lambda | 0.2h | `publish-template.ts` |
| Version history panel (UI) | 0.1h | `VersionHistoryPanel.tsx` |

**Total: 10 hours**

---

## 15. Acceptance Criteria

| # | Criteria | Priority |
|---|---|---|
| AC-1 | Template library page displays categorized templates with filtering | P0 |
| AC-2 | CRUD operations (create, read, update, delete) work correctly | P0 |
| AC-3 | Macro replacement works — `{{company_name}}` replaced with actual org name | P0 |
| AC-4 | Apply template generates valid `ProposalDocument` that can be saved | P0 |
| AC-5 | Version control tracks changes with version numbers and change notes | P1 |
| AC-6 | Rollback restores previous version content as a new version | P1 |
| AC-7 | Publish/draft workflow controls template visibility | P1 |
| AC-8 | Clone creates independent copy of a template | P1 |
| AC-9 | UI for template management (create, edit, preview, apply) is functional | P0 |
| AC-10 | Templates are org-scoped — users only see their org's templates | P0 |
| AC-11 | RBAC permissions enforced on all endpoints | P0 |
| AC-12 | Tested with all 6 seed templates (Technical, Management, Past Performance, Price, Executive Summary, Certifications) | P0 |
| AC-13 | Import/export templates as JSON works | P2 |
| AC-14 | Agency-specific templates can be created via clone + customize | P1 |

---

## Cross-References

- **Proposal Schema:** `shared/src/schemas/proposal.ts` — `ProposalDocumentSchema`
- **Content Library Pattern:** `shared/src/schemas/content-library.ts` — versioning, approval workflow
- **Existing Proposal Generation:** `infrastructure/lambda/proposal/generate-proposal.ts`
- **RBAC Middleware:** `infrastructure/lambda/middleware/rbac-middleware.ts`
- **DynamoDB Helpers:** `infrastructure/lambda/helpers/db.ts`
- **S3 Helpers:** `infrastructure/lambda/helpers/s3.ts`
- **API Route Pattern:** `infrastructure/lib/api/routes/content-library.routes.ts`
- **SWR Hook Pattern:** `web-app/lib/hooks/use-content-library.ts`
- **Component Pattern:** `web-app/components/content-library/`
- **Document Hub Design:** `docs/DOCUMENT-HUB-IMPLEMENTATION.md`

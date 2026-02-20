import { z } from 'zod';

// ================================
// Enums & Constants
// ================================

export const TEMPLATE_CATEGORIES = [
  // Core proposal sections (win-optimized order)
  'COVER_LETTER',
  'EXECUTIVE_SUMMARY',
  'UNDERSTANDING_OF_REQUIREMENTS',
  'TECHNICAL_PROPOSAL',
  'PROJECT_PLAN',
  'TEAM_QUALIFICATIONS',
  'PAST_PERFORMANCE',
  'COST_PROPOSAL',
  'MANAGEMENT_APPROACH',
  'RISK_MANAGEMENT',
  'COMPLIANCE_MATRIX',
  'CERTIFICATIONS',
  'APPENDICES',
  // Supporting / administrative
  'MANAGEMENT_PROPOSAL',
  'PRICE_VOLUME',
  'QUALITY_MANAGEMENT',
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
  key: z.string().min(1).max(100).regex(
    /^[a-z][a-z0-9_]*$/,
    'Macro key must be lowercase alphanumeric with underscores, starting with a letter',
  ),
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
  content: z.string().max(100000),
  order: z.number().int().min(0),
  pageLimit: z.number().int().min(1).optional(),
  required: z.boolean().default(true),
  description: z.string().max(1000).optional(),
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

export const createTemplateSK = (orgId: string, templateId: string): string =>
  `${orgId}#${templateId}`;

export const createGlobalTemplateSK = (templateId: string): string =>
  `GLOBAL#${templateId}`;

export const parseTemplateSK = (sk: string): { orgId: string; templateId: string } | null => {
  const parts = sk.split('#');
  if (parts.length !== 2) return null;
  return { orgId: parts[0], templateId: parts[1] };
};

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
  { key: 'proposal_title', label: 'Proposal Title', description: 'Title of the proposal being generated', type: 'SYSTEM', dataSource: 'project.title', required: false },
];

// ================================
// Category Labels
// ================================

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  // Core proposal sections (win-optimized order)
  COVER_LETTER: 'Cover Letter',
  EXECUTIVE_SUMMARY: 'Executive Summary',
  UNDERSTANDING_OF_REQUIREMENTS: 'Understanding of Requirements',
  TECHNICAL_PROPOSAL: 'Technical Proposal',
  PROJECT_PLAN: 'Project Plan',
  TEAM_QUALIFICATIONS: 'Team Qualifications',
  PAST_PERFORMANCE: 'Past Performance',
  COST_PROPOSAL: 'Cost Proposal',
  MANAGEMENT_APPROACH: 'Management Approach',
  RISK_MANAGEMENT: 'Risk Management',
  COMPLIANCE_MATRIX: 'Compliance Matrix',
  CERTIFICATIONS: 'Certifications',
  APPENDICES: 'Appendices',
  // Supporting / administrative
  MANAGEMENT_PROPOSAL: 'Management Proposal',
  PRICE_VOLUME: 'Price Volume',
  QUALITY_MANAGEMENT: 'Quality Management Plan',
  CUSTOM: 'Custom',
};

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
  'CLARIFYING_QUESTIONS',
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
    /^[A-Z][A-Z0-9_]*$/,
    'Macro key must be UPPER_CASE alphanumeric with underscores, starting with a letter',
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
  category: TemplateCategorySchema,
  description: z.string().max(2000).optional(),

  // Template content (current version)
  // sections is kept for backward compat but content is stored in S3 via htmlContentKey
  sections: z.array(TemplateSectionSchema).default([]),
  macros: z.array(MacroDefinitionSchema).default([]),
  styling: StylingConfigSchema.optional(),
  /**
   * S3 key for the HTML content of the template.
   * When present, the full HTML lives in S3 and this field is the key.
   * Replaces the sections[].content pattern for simpler storage.
   */
  htmlContentKey: z.string().nullable().optional(),

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
  category: TemplateCategorySchema,
  description: z.string().max(2000).optional(),
  /** Raw HTML content — stored in S3, key saved as htmlContentKey */
  htmlContent: z.string().max(10_000_000).optional(),
  macros: z.array(MacroDefinitionSchema).optional(),
  styling: StylingConfigSchema.optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  agencyId: z.string().max(200).optional(),
  agencyName: z.string().max(500).optional(),
});

export type CreateTemplateDTO = z.infer<typeof CreateTemplateDTOSchema>;

export const UpdateTemplateDTOSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  category: TemplateCategorySchema.optional(),
  description: z.string().max(2000).optional(),
  /** Raw HTML content — stored in S3, key saved as htmlContentKey */
  htmlContent: z.string().max(10_000_000).optional(),
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
    category: TemplateCategorySchema,
    description: z.string().max(2000).optional(),
    /** Raw HTML content — stored in S3, key saved as htmlContentKey */
    htmlContent: z.string().max(10_000_000).optional(),
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
// Keys use UPPER_CASE — use as {{TODAY}}, {{COMPANY_NAME}}, etc. in template content
// ================================

export const SYSTEM_MACROS: MacroDefinition[] = [
  // Organization
  { key: 'COMPANY_NAME',              label: 'Company Name',              description: 'Your organization name',                                     type: 'SYSTEM', dataSource: 'organization.name',                 required: false },
  { key: 'ORGANIZATION_DESCRIPTION',  label: 'Organization Description',  description: 'Organization description/overview',                          type: 'SYSTEM', dataSource: 'organization.description',          required: false },
  // Project
  { key: 'PROJECT_TITLE',             label: 'Project Title',             description: 'Project name',                                               type: 'SYSTEM', dataSource: 'project.name',                      required: false },
  { key: 'PROJECT_DESCRIPTION',       label: 'Project Description',       description: 'Project description',                                        type: 'SYSTEM', dataSource: 'project.description',               required: false },
  { key: 'PROPOSAL_TITLE',            label: 'Proposal Title',            description: 'Proposal title (alias for PROJECT_TITLE)',                   type: 'SYSTEM', dataSource: 'project.name',                      required: false },
  // Opportunity
  { key: 'OPPORTUNITY_ID',            label: 'Opportunity ID',            description: 'Unique opportunity identifier',                              type: 'SYSTEM', dataSource: 'opportunity.id',                    required: false },
  { key: 'OPPORTUNITY_TITLE',         label: 'Opportunity Title',         description: 'Official title of the opportunity',                          type: 'SYSTEM', dataSource: 'opportunity.title',                 required: false },
  { key: 'SOLICITATION_NUMBER',       label: 'Solicitation Number',       description: 'Official solicitation number',                               type: 'SYSTEM', dataSource: 'opportunity.solicitationNumber',    required: false },
  { key: 'NOTICE_ID',                 label: 'Notice ID',                 description: 'SAM.gov notice ID',                                          type: 'SYSTEM', dataSource: 'opportunity.noticeId',              required: false },
  // Agency/Customer
  { key: 'AGENCY_NAME',               label: 'Agency Name',               description: 'Primary agency name',                                        type: 'SYSTEM', dataSource: 'opportunity.organizationName',      required: false },
  { key: 'ISSUING_OFFICE',            label: 'Issuing Office',            description: 'Full issuing office name',                                   type: 'SYSTEM', dataSource: 'opportunity.organizationName',      required: false },
  // Dates
  { key: 'TODAY',                     label: 'Today',                     description: 'Current date (YYYY-MM-DD format)',                           type: 'SYSTEM', dataSource: '_generated.currentDate',            required: false },
  { key: 'CURRENT_YEAR',              label: 'Current Year',              description: 'Current year',                                               type: 'SYSTEM', dataSource: '_generated.currentYear',            required: false },
  { key: 'CURRENT_MONTH',             label: 'Current Month',             description: 'Current month name',                                         type: 'SYSTEM', dataSource: '_generated.currentMonth',           required: false },
  { key: 'CURRENT_DAY',               label: 'Current Day',               description: 'Current day of month',                                       type: 'SYSTEM', dataSource: '_generated.currentDay',             required: false },
  { key: 'POSTED_DATE',               label: 'Posted Date',               description: 'Date opportunity was posted',                                type: 'SYSTEM', dataSource: 'opportunity.postedDateIso',          required: false },
  { key: 'RESPONSE_DEADLINE',         label: 'Response Deadline',         description: 'Proposal submission deadline',                               type: 'SYSTEM', dataSource: 'opportunity.responseDeadlineIso',    required: false },
  { key: 'SUBMISSION_DATE',           label: 'Submission Date',           description: 'Alias for RESPONSE_DEADLINE',                                type: 'SYSTEM', dataSource: 'opportunity.responseDeadlineIso',    required: false },
  // Compliance & Classification
  { key: 'NAICS_CODE',                label: 'NAICS Code',                description: 'North American Industry Classification System code',         type: 'SYSTEM', dataSource: 'opportunity.naicsCode',             required: false },
  { key: 'PSC_CODE',                  label: 'PSC Code',                  description: 'Product/Service Code',                                       type: 'SYSTEM', dataSource: 'opportunity.pscCode',               required: false },
  { key: 'SET_ASIDE',                 label: 'Set-Aside Type',            description: 'Set-aside category',                                         type: 'SYSTEM', dataSource: 'opportunity.setAside',              required: false },
  { key: 'OPPORTUNITY_TYPE',          label: 'Opportunity Type',          description: 'Type of opportunity/contract',                               type: 'SYSTEM', dataSource: 'opportunity.type',                  required: false },
  // Financial
  { key: 'ESTIMATED_VALUE',           label: 'Estimated Value',           description: 'Estimated contract value (formatted as USD)',                type: 'SYSTEM', dataSource: 'opportunity.baseAndAllOptionsValue', required: false },
  { key: 'BASE_AND_OPTIONS_VALUE',    label: 'Base and Options Value',    description: 'Total base + option periods value',                          type: 'SYSTEM', dataSource: 'opportunity.baseAndAllOptionsValue', required: false },
  // Content
  { key: 'CONTENT',                   label: 'Content',                   description: 'Placeholder for AI-generated or user-authored content',      type: 'SYSTEM', dataSource: '_generated.content',                required: false },
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
  CLARIFYING_QUESTIONS: 'Clarifying Questions',
  CUSTOM: 'Custom',
};

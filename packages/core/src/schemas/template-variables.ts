/**
 * Template variable definitions for RFP document generation.
 * These variables can be used in templates with the syntax {{VARIABLE_NAME}}
 */

export interface TemplateVariable {
  /** Variable name (e.g., "COMPANY_NAME") */
  name: string;
  /** User-friendly label */
  label: string;
  /** Detailed description of what the variable represents */
  description: string;
  /** Category for grouping in UI */
  category: TemplateVariableCategory;
  /** Example value */
  example: string;
}

export type TemplateVariableCategory =
  | 'ORGANIZATION'
  | 'PROJECT'
  | 'OPPORTUNITY'
  | 'AGENCY'
  | 'DATES'
  | 'COMPLIANCE'
  | 'FINANCIAL'
  | 'CONTENT';

/**
 * All available template variables with their metadata.
 * Used for documentation, UI hints, and validation.
 */
export const TEMPLATE_VARIABLES: Record<string, TemplateVariable> = {
  // Organization Variables
  COMPANY_NAME: {
    name: 'COMPANY_NAME',
    label: 'Company Name',
    description: 'Your organization/company name',
    category: 'ORGANIZATION',
    example: 'Acme Technologies, Inc.',
  },
  ORGANIZATION_DESCRIPTION: {
    name: 'ORGANIZATION_DESCRIPTION',
    label: 'Organization Description',
    description: 'Organization description/overview',
    category: 'ORGANIZATION',
    example: 'Leading provider of cloud solutions...',
  },

  // Project Variables
  PROJECT_TITLE: {
    name: 'PROJECT_TITLE',
    label: 'Project Title',
    description: 'Project name',
    category: 'PROJECT',
    example: 'NASA Ground Systems Modernization',
  },
  PROJECT_DESCRIPTION: {
    name: 'PROJECT_DESCRIPTION',
    label: 'Project Description',
    description: 'Project description',
    category: 'PROJECT',
    example: 'Modernization of legacy ground control systems...',
  },
  PROPOSAL_TITLE: {
    name: 'PROPOSAL_TITLE',
    label: 'Proposal Title',
    description: 'Proposal title (alias for PROJECT_TITLE)',
    category: 'PROJECT',
    example: 'NASA Ground Systems Modernization',
  },

  // Opportunity Variables
  OPPORTUNITY_ID: {
    name: 'OPPORTUNITY_ID',
    label: 'Opportunity ID',
    description: 'Unique opportunity identifier',
    category: 'OPPORTUNITY',
    example: '140D6424R00004',
  },
  OPPORTUNITY_TITLE: {
    name: 'OPPORTUNITY_TITLE',
    label: 'Opportunity Title',
    description: 'Official title of the opportunity',
    category: 'OPPORTUNITY',
    example: 'Enterprise Cloud Services - Full Stack',
  },
  SOLICITATION_NUMBER: {
    name: 'SOLICITATION_NUMBER',
    label: 'Solicitation Number',
    description: 'Official solicitation number',
    category: 'OPPORTUNITY',
    example: 'FA8201-24-R-0001',
  },
  NOTICE_ID: {
    name: 'NOTICE_ID',
    label: 'Notice ID',
    description: 'SAM.gov notice ID',
    category: 'OPPORTUNITY',
    example: '140d6424r00004',
  },

  // Agency/Customer Information
  AGENCY_NAME: {
    name: 'AGENCY_NAME',
    label: 'Agency Name',
    description: 'Primary agency name (short form)',
    category: 'AGENCY',
    example: 'GSA',
  },
  ISSUING_OFFICE: {
    name: 'ISSUING_OFFICE',
    label: 'Issuing Office',
    description: 'Full issuing office name',
    category: 'AGENCY',
    example: 'General Services Administration, Federal Acquisition Service',
  },

  // Date Variables
  TODAY: {
    name: 'TODAY',
    label: 'Today',
    description: 'Current date (YYYY-MM-DD format)',
    category: 'DATES',
    example: '2024-03-15',
  },
  CURRENT_YEAR: {
    name: 'CURRENT_YEAR',
    label: 'Current Year',
    description: 'Current year',
    category: 'DATES',
    example: '2024',
  },
  CURRENT_MONTH: {
    name: 'CURRENT_MONTH',
    label: 'Current Month',
    description: 'Current month name',
    category: 'DATES',
    example: 'March',
  },
  CURRENT_DAY: {
    name: 'CURRENT_DAY',
    label: 'Current Day',
    description: 'Current day of month',
    category: 'DATES',
    example: '15',
  },
  POSTED_DATE: {
    name: 'POSTED_DATE',
    label: 'Posted Date',
    description: 'Date opportunity was posted',
    category: 'DATES',
    example: 'January 15, 2024',
  },
  RESPONSE_DEADLINE: {
    name: 'RESPONSE_DEADLINE',
    label: 'Response Deadline',
    description: 'Proposal submission deadline',
    category: 'DATES',
    example: 'March 30, 2024',
  },
  SUBMISSION_DATE: {
    name: 'SUBMISSION_DATE',
    label: 'Submission Date',
    description: 'Alias for RESPONSE_DEADLINE',
    category: 'DATES',
    example: 'March 30, 2024',
  },

  // Compliance & Classification
  NAICS_CODE: {
    name: 'NAICS_CODE',
    label: 'NAICS Code',
    description: 'North American Industry Classification System code',
    category: 'COMPLIANCE',
    example: '541512',
  },
  PSC_CODE: {
    name: 'PSC_CODE',
    label: 'PSC Code',
    description: 'Product/Service Code',
    category: 'COMPLIANCE',
    example: 'D302',
  },
  SET_ASIDE: {
    name: 'SET_ASIDE',
    label: 'Set-Aside Type',
    description: 'Set-aside category (e.g., Small Business, 8(a), HUBZone)',
    category: 'COMPLIANCE',
    example: 'Total Small Business Set-Aside',
  },
  OPPORTUNITY_TYPE: {
    name: 'OPPORTUNITY_TYPE',
    label: 'Opportunity Type',
    description: 'Type of opportunity/contract (from SAM.gov or solicitation)',
    category: 'COMPLIANCE',
    example: 'Combined Synopsis/Solicitation',
  },

  // Financial Variables
  ESTIMATED_VALUE: {
    name: 'ESTIMATED_VALUE',
    label: 'Estimated Value',
    description: 'Estimated contract value (formatted as USD)',
    category: 'FINANCIAL',
    example: '$5,000,000',
  },
  BASE_AND_OPTIONS_VALUE: {
    name: 'BASE_AND_OPTIONS_VALUE',
    label: 'Base and Options Value',
    description: 'Total base + option periods value',
    category: 'FINANCIAL',
    example: '$5,000,000',
  },

  // Content Placeholder
  CONTENT: {
    name: 'CONTENT',
    label: 'Content',
    description: 'Placeholder for AI-generated or user-authored content',
    category: 'CONTENT',
    example: '[Content will be generated here]',
  },
};

/**
 * Get all variables grouped by category.
 * Useful for displaying variables in a categorized UI.
 */
export const getVariablesByCategory = (): Record<TemplateVariableCategory, TemplateVariable[]> => {
  const grouped: Record<TemplateVariableCategory, TemplateVariable[]> = {
    ORGANIZATION: [],
    PROJECT: [],
    OPPORTUNITY: [],
    AGENCY: [],
    DATES: [],
    COMPLIANCE: [],
    FINANCIAL: [],
    CONTENT: [],
  };

  Object.values(TEMPLATE_VARIABLES).forEach((variable) => {
    grouped[variable.category].push(variable);
  });

  return grouped;
};

/**
 * Get all variable names as an array.
 * Useful for validation and autocomplete.
 */
export const getVariableNames = (): string[] => {
  return Object.keys(TEMPLATE_VARIABLES);
};

/**
 * Check if a variable name is valid.
 */
export const isValidVariable = (name: string): boolean => {
  return name in TEMPLATE_VARIABLES;
};

/**
 * Category labels for UI display.
 */
export const TEMPLATE_VARIABLE_CATEGORY_LABELS: Record<TemplateVariableCategory, string> = {
  ORGANIZATION: 'Organization',
  PROJECT: 'Project',
  OPPORTUNITY: 'Opportunity',
  AGENCY: 'Agency/Customer',
  DATES: 'Dates',
  COMPLIANCE: 'Compliance & Classification',
  FINANCIAL: 'Financial',
  CONTENT: 'Content',
};

/**
 * Category descriptions for UI tooltips.
 */
export const TEMPLATE_VARIABLE_CATEGORY_DESCRIPTIONS: Record<TemplateVariableCategory, string> = {
  ORGANIZATION: 'Variables from your company/organization profile',
  PROJECT: 'Variables from the current project',
  OPPORTUNITY: 'Variables from the SAM.gov opportunity or solicitation',
  AGENCY: 'Variables about the customer or issuing agency',
  DATES: 'Date and deadline variables',
  COMPLIANCE: 'Compliance codes and contract classifications',
  FINANCIAL: 'Contract value and financial information',
  CONTENT: 'Placeholder for content generation',
};

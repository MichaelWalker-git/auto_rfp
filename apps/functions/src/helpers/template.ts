import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getItem, queryAllBySkPrefix } from './db';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { createTemplateSK, isReservedPageToken, TEMPLATE_PK, type TemplateItem } from '@auto-rfp/core';
import { loadTextFromS3, uploadToS3 } from './s3';
import { nowIso } from './date';
import { getProjectById } from './project';
import { getOrganizationById } from './org';
import { getOpportunity } from './opportunity';
import { getExecutiveBriefByProjectId } from './executive-opportunity-brief';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

export const putTemplate = async (item: TemplateItem): Promise<void> => {
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      ...item,
      [PK_NAME]: TEMPLATE_PK,
      [SK_NAME]: createTemplateSK(item.orgId, item.id),
    },
  }));
};

export const getTemplate = async (orgId: string, templateId: string,) =>
  getItem<TemplateItem>(TEMPLATE_PK, createTemplateSK(orgId, templateId));

export const listTemplatesByOrg = async (
  orgId: string,
  options?: {
    category?: string;
    status?: string;
    excludeArchived?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<{ items: TemplateItem[]; total: number }> => {
  const filterExpressions: string[] = [];
  const exprAttrNames: Record<string, string> = {
    '#pk': PK_NAME,
    '#sk': SK_NAME,
  };
  const exprAttrValues: Record<string, unknown> = {
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
};

export const updateTemplateFields = async (
  orgId: string,
  templateId: string,
  updates: Record<string, unknown>,
): Promise<void> => {
  const updateParts: string[] = [];
  const exprAttrNames: Record<string, string> = {};
  const exprAttrValues: Record<string, unknown> = {};

  Object.entries(updates).forEach(([key, value], idx) => {
    const nameKey = `#f${idx}`;
    const valueKey = `:v${idx}`;
    updateParts.push(`${nameKey} = ${valueKey}`);
    exprAttrNames[nameKey] = key;
    exprAttrValues[valueKey] = value;
  });

  if (updateParts.length === 0) return;

  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      [PK_NAME]: TEMPLATE_PK,
      [SK_NAME]: createTemplateSK(orgId, templateId),
    },
    UpdateExpression: `SET ${updateParts.join(', ')}`,
    ExpressionAttributeNames: exprAttrNames,
    ExpressionAttributeValues: exprAttrValues,
  }));
};

/**
 * Build the S3 key for a template's HTML content.
 */
export const buildTemplateHtmlKey = (orgId: string, templateId: string): string =>
  `templates/${orgId}/${templateId}/content.html`;

/**
 * Upload raw HTML content to S3 and return the S3 key.
 */
export const uploadTemplateHtml = async (
  orgId: string,
  templateId: string,
  html: string,
): Promise<string> => {
  const key = buildTemplateHtmlKey(orgId, templateId);
  await uploadToS3(DOCUMENTS_BUCKET, key, html, 'text/html');
  return key;
};

/**
 * Load raw HTML content from S3 for a template.
 */
export const loadTemplateHtml = async (htmlContentKey: string): Promise<string> =>
  loadTextFromS3(DOCUMENTS_BUCKET, htmlContentKey);

// ================================
// Template Selection
// ================================

/**
 * Find the best template for a given org and document category.
 * Prefers the default template, then PUBLISHED over DRAFT, then most recently updated.
 * Returns null if no matching template is found.
 */
export const findBestTemplate = async (
  orgId: string,
  category: string,
): Promise<TemplateItem | null> => {
  const { items: allItems } = await listTemplatesByOrg(orgId, {
    category,
    excludeArchived: true,
    limit: 50,
  });

  if (allItems.length === 0) return null;

  // Sort: default first, then PUBLISHED, then by updatedAt descending (most recent first)
  const sorted = [...allItems].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (b.isDefault && !a.isDefault) return 1;
    if (a.status === 'PUBLISHED' && b.status !== 'PUBLISHED') return -1;
    if (b.status === 'PUBLISHED' && a.status !== 'PUBLISHED') return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const best = sorted[0]!;
  console.log(`Selected template for ${category}: "${best.name}" (${best.status}, isDefault: ${best.isDefault ?? false}, updated: ${best.updatedAt})`);
  return best;
};

/**
 * Clear the default marker from every template in a category for an org,
 * optionally skipping one template id (the one being newly marked).
 * Returns the ids that were cleared.
 */
export const clearDefaultForCategory = async (
  orgId: string,
  category: string,
  exceptTemplateId?: string,
): Promise<string[]> => {
  const allItems = await queryAllBySkPrefix<TemplateItem>(TEMPLATE_PK, `${orgId}#`);

  const toClear = allItems.filter(
    (t) => t.category === category && t.isDefault && t.id !== exceptTemplateId,
  );

  await Promise.all(
    toClear.map((t) =>
      updateTemplateFields(orgId, t.id, { isDefault: false, updatedAt: nowIso() }),
    ),
  );

  return toClear.map((t) => t.id);
};

/**
 * Mark a template as the default template for its category.
 * Enforces one default template per category per org by clearing any
 * previously marked template in the same category first.
 */
export const setDefaultTemplate = async (
  orgId: string,
  templateId: string,
  category: string,
): Promise<void> => {
  await clearDefaultForCategory(orgId, category, templateId);
  await updateTemplateFields(orgId, templateId, {
    isDefault: true,
    updatedAt: nowIso(),
  });
};

// ================================
// Macro Engine
// ================================

/**
 * Format an ISO date string for display.
 */
const formatDateSafe = (isoDate: string): string => {
  try {
    return new Date(isoDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return isoDate;
  }
};

/**
 * Format a number as US currency (no decimals).
 */
const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

/**
 * Format a contact object as "Name (email)" string.
 */
const formatContact = (contact?: { name?: string | null; email?: string | null }): string => {
  if (!contact) return '';
  const parts: string[] = [];
  if (contact.name) parts.push(contact.name);
  if (contact.email) parts.push(`(${contact.email})`);
  return parts.join(' ');
};

/**
 * Build macro values from real project, organization, and opportunity data.
 * Returns a Record<string, string> that can be passed to replaceMacros().
 */
export const buildMacroValues = async (params: {
  orgId: string;
  projectId: string;
  opportunityId?: string;
}): Promise<Record<string, string>> => {
  const { orgId, projectId, opportunityId } = params;

  // Load data in parallel.
  // Pass orgId so the project fetch uses the exact-key GetItem path (not a Scan),
  // and force a consistent read: generation is often triggered moments after the
  // user saves POC contact info, and an eventually-consistent read can return a
  // stale project whose contactInfo is still empty — silently resolving
  // {{PROJECT_POC_EMAIL}} to '' and leaving "Email:" blank in the document.
  const [project, org, opportunity] = await Promise.all([
    getProjectById(projectId, orgId, { consistentRead: true }),
    getOrganizationById(orgId),
    opportunityId ? getOpportunity({ orgId, projectId, oppId: opportunityId }).then(result => result?.item) : Promise.resolve(undefined),
  ]);

  const today = new Date();
  const macroValues: Record<string, string> = {
    // Date macros
    TODAY: today.toISOString().split('T')[0],
    CURRENT_YEAR: String(today.getFullYear()),
    CURRENT_MONTH: today.toLocaleDateString('en-US', { month: 'long' }),
    CURRENT_DAY: String(today.getDate()),
    // CONTENT macro: visible placeholder so the AI knows where to insert generated content.
    CONTENT: '[CONTENT: Write the complete document content here based on the solicitation requirements and provided context. Preserve all surrounding template elements (images, dates, company name, etc.) exactly as they appear.]',
  };

  // Organization macros
  if (org) {
    macroValues.COMPANY_NAME = org.name || '';
    macroValues.ORGANIZATION_DESCRIPTION = org.description || '';
  }

  // Project macros
  if (project) {
    macroValues.PROJECT_TITLE = project.name || '';
    macroValues.PROPOSAL_TITLE = project.name || '';
    macroValues.PROJECT_DESCRIPTION = project.description || '';

    // Project contact info macros
    macroValues.PROJECT_POC_NAME = project.contactInfo?.primaryPocName || '';
    macroValues.PROJECT_POC_EMAIL = project.contactInfo?.primaryPocEmail || '';
    macroValues.PROJECT_POC_PHONE = project.contactInfo?.primaryPocPhone || '';
    macroValues.PROJECT_POC_TITLE = project.contactInfo?.primaryPocTitle || '';

    // Diagnostic: a fully-empty contact block usually means the project was read
    // before the user's POC save propagated, or POC was never set. Log it so a
    // blank "Email:" line in the output is traceable instead of silent.
    if (!project.contactInfo || Object.values(project.contactInfo).every((v) => !v)) {
      console.warn(
        `[buildMacroValues] Project ${projectId} has no contact info — PROJECT_POC_* macros will resolve empty (orgId=${orgId})`,
      );
    }
  } else {
    console.warn(`[buildMacroValues] Project ${projectId} not found (orgId=${orgId}) — PROJECT_* macros unavailable`);
  }

  // Opportunity macros
  if (opportunity) {
    macroValues.OPPORTUNITY_ID = opportunity.id || '';
    macroValues.NOTICE_ID = opportunity.noticeId || '';
    macroValues.SOLICITATION_NUMBER = opportunity.solicitationNumber || '';
    macroValues.OPPORTUNITY_TITLE = opportunity.title || '';

    // Agency information
    macroValues.AGENCY_NAME = opportunity.organizationName || '';
    macroValues.ISSUING_OFFICE = opportunity.organizationName || '';

    // Dates
    if (opportunity.postedDateIso) {
      macroValues.POSTED_DATE = formatDateSafe(opportunity.postedDateIso);
    }
    if (opportunity.responseDeadlineIso) {
      macroValues.RESPONSE_DEADLINE = formatDateSafe(opportunity.responseDeadlineIso);
      macroValues.SUBMISSION_DATE = macroValues.RESPONSE_DEADLINE;
    }

    // Classification codes
    macroValues.NAICS_CODE = opportunity.naicsCode || '';
    macroValues.PSC_CODE = opportunity.pscCode || '';

    // Compliance information
    macroValues.SET_ASIDE = opportunity.setAside || '';
    macroValues.OPPORTUNITY_TYPE = opportunity.type || '';

    // Financial information
    if (opportunity.baseAndAllOptionsValue) {
      const value = opportunity.baseAndAllOptionsValue;
      const formatted = typeof value === 'number' && value > 0
        ? formatCurrency(value)
        : String(value);
      macroValues.ESTIMATED_VALUE = formatted;
      macroValues.BASE_AND_OPTIONS_VALUE = formatted;
    }

    // Solicitation organization macros
    macroValues.SOLICITATION_ORG_NAME = opportunity.organizationName || '';
    macroValues.SOLICITATION_ORG_OFFICE = opportunity.organizationName || '';
  }

  // Brief contacts macros — load executive brief if opportunity is provided
  if (opportunityId) {
    try {
      const brief = await getExecutiveBriefByProjectId(projectId, opportunityId);

      // Extract solicitation org details from brief summary
      const summaryData = brief?.sections?.summary?.data;
      if (summaryData) {
        if (summaryData.office) {
          macroValues.SOLICITATION_ORG_OFFICE = summaryData.office;
        }
        if (summaryData.placeOfPerformance) {
          macroValues.SOLICITATION_ORG_LOCATION = summaryData.placeOfPerformance;
        }
        if (summaryData.agency && !macroValues.SOLICITATION_ORG_NAME) {
          macroValues.SOLICITATION_ORG_NAME = summaryData.agency;
        }
      }

      // Extract contacts from brief
      const contacts = brief?.sections?.contacts?.data?.contacts;
      if (contacts?.length) {
        const contractingOfficer = contacts.find((c) => c.role === 'CONTRACTING_OFFICER');
        const technicalPoc = contacts.find((c) => c.role === 'TECHNICAL_POC');

        macroValues.CONTRACTING_OFFICER = formatContact(contractingOfficer);
        macroValues.TECHNICAL_POC = formatContact(technicalPoc);
      }
    } catch (err) {
      console.warn('No executive brief found for opportunity:', opportunityId, (err as Error)?.message);
    }
  }

  return macroValues;
};

export const replaceMacros = (
  text: string,
  macroValues: Record<string, string>,
  options: { removeUnresolved?: boolean } = {},
): string =>
  text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    // Page tokens must survive macro substitution untouched. They are resolved
    // later by each renderer as a native live field (Word PageNumber / Puppeteer
    // .pageNumber span), because page numbers do not exist until pagination —
    // long after this runs. `removeUnresolved` would otherwise delete them.
    if (isReservedPageToken(key)) return match;
    if (key in macroValues) return macroValues[key];
    return options.removeUnresolved ? '' : match;
  });
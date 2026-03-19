import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
} from '@/middleware/rbac-middleware';
import { getTemplate, loadTemplateHtml, replaceMacros } from '@/helpers/template';

const SAMPLE_MACRO_VALUES: Record<string, string> = {
  // Organization
  COMPANY_NAME:              'Acme Corporation',
  ORGANIZATION_DESCRIPTION:  'Leading provider of cloud infrastructure solutions',
  // Project
  PROJECT_TITLE:             'Cloud Migration Services',
  PROJECT_DESCRIPTION:       'Enterprise cloud migration and modernization',
  PROPOSAL_TITLE:            'Technical Proposal for Cloud Migration Services',
  // Opportunity
  OPPORTUNITY_ID:            '140D6426R00001',
  OPPORTUNITY_TITLE:         'Cloud Infrastructure Modernization',
  SOLICITATION_NUMBER:       'W911NF-26-R-0001',
  NOTICE_ID:                 '140d6426r00001',
  // Agency
  AGENCY_NAME:               'GSA',
  ISSUING_OFFICE:            'General Services Administration, Federal Acquisition Service',
  // Dates
  TODAY:                     new Date().toISOString().split('T')[0],
  CURRENT_YEAR:              new Date().getFullYear().toString(),
  CURRENT_MONTH:             new Date().toLocaleDateString('en-US', { month: 'long' }),
  CURRENT_DAY:               new Date().getDate().toString(),
  POSTED_DATE:               'January 15, 2026',
  RESPONSE_DEADLINE:         'March 15, 2026',
  SUBMISSION_DATE:           'March 15, 2026',
  // Compliance
  NAICS_CODE:                '541512',
  PSC_CODE:                  'D302',
  SET_ASIDE:                 'Total Small Business Set-Aside',
  OPPORTUNITY_TYPE:          'Combined Synopsis/Solicitation',
  // Financial
  ESTIMATED_VALUE:           '$5,000,000',
  BASE_AND_OPTIONS_VALUE:    '$5,000,000',
  // Content
  CONTENT:                   '[Content will be generated here]',
};

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const templateId = event.pathParameters?.id;
    if (!templateId) return apiResponse(400, { error: 'Missing template ID' });

    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const template = await getTemplate(orgId, templateId);
    if (!template) return apiResponse(404, { error: 'Template not found' });

    // Load HTML content from S3
    let htmlContent = '';
    if (template.htmlContentKey) {
      try {
        htmlContent = await loadTemplateHtml(template.htmlContentKey);
      } catch (err) {
        console.warn('Failed to load template HTML from S3:', err);
      }
    }

    const allMacros = { ...SAMPLE_MACRO_VALUES };

    const previewHtml = replaceMacros(htmlContent, allMacros);

    return apiResponse(200, {
      templateId: template.id,
      templateName: replaceMacros(template.name, allMacros),
      description: template.description
        ? replaceMacros(template.description, allMacros)
        : null,
      htmlContent: previewHtml,
      macrosUsed: allMacros,
    });
  } catch (err) {
    console.error('Error previewing template:', err);
    return apiResponse(500, {
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(httpErrorMiddleware()),
);

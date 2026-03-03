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
  COMPANY_NAME:    'Acme Corporation',
  PROJECT_TITLE:   'Cloud Migration Services',
  CONTRACT_NUMBER: 'W911NF-26-R-0001',
  SUBMISSION_DATE: '2026-03-15',
  PAGE_LIMIT:      '50',
  OPPORTUNITY_ID:  'SAM-2026-001',
  AGENCY_NAME:     'Department of Defense',
  TODAY:           new Date().toISOString().split('T')[0],
  PROPOSAL_TITLE:  'Technical Proposal for Cloud Migration Services',
  CONTENT:         '[Content will be generated here]',
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

    const customMacroDefaults = template.macros
      .filter(m => m.type === 'CUSTOM' && m.defaultValue)
      .reduce<Record<string, string>>((acc, m) => {
        acc[m.key] = m.defaultValue!;
        return acc;
      }, {});

    const allMacros = { ...SAMPLE_MACRO_VALUES, ...customMacroDefaults };

    const previewHtml = replaceMacros(htmlContent, allMacros);

    return apiResponse(200, {
      templateId: template.id,
      templateName: replaceMacros(template.name, allMacros),
      description: template.description
        ? replaceMacros(template.description, allMacros)
        : null,
      htmlContent: previewHtml,
      macrosUsed: allMacros,
      styling: template.styling,
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

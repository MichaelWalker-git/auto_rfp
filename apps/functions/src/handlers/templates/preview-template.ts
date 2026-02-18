import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
} from '@/middleware/rbac-middleware';
import { getTemplate, replaceMacros } from '@/helpers/template';

const SAMPLE_MACRO_VALUES: Record<string, string> = {
  company_name: 'Acme Corporation',
  project_title: 'Cloud Migration Services',
  contract_number: 'W911NF-26-R-0001',
  submission_date: '2026-03-15',
  page_limit: '50',
  opportunity_id: 'SAM-2026-001',
  agency_name: 'Department of Defense',
  current_date: new Date().toISOString().split('T')[0],
  proposal_title: 'Technical Proposal for Cloud Migration Services',
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

    const customMacroDefaults = template.macros
      .filter(m => m.type === 'CUSTOM' && m.defaultValue)
      .reduce<Record<string, string>>((acc, m) => {
        acc[m.key] = m.defaultValue!;
        return acc;
      }, {});

    const allMacros = { ...SAMPLE_MACRO_VALUES, ...customMacroDefaults };

    const previewSections = template.sections
      .sort((a, b) => a.order - b.order)
      .map(section => ({
        id: section.id,
        title: replaceMacros(section.title, allMacros),
        content: replaceMacros(section.content, allMacros),
        required: section.required,
        subsections: (section.subsections ?? [])
          .sort((a, b) => a.order - b.order)
          .map(sub => ({
            id: sub.id,
            title: replaceMacros(sub.title, allMacros),
            content: replaceMacros(sub.content, allMacros),
          })),
      }));

    return apiResponse(200, {
      templateId: template.id,
      templateName: replaceMacros(template.name, allMacros),
      description: template.description
        ? replaceMacros(template.description, allMacros)
        : null,
      sections: previewSections,
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
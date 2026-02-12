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

const resolveSystemMacros = async (
  projectId: string,
  _orgId: string,
): Promise<Record<string, string>> => {
  const project = await getProjectById(projectId);
  const org = (project as any)?.organization;

  return {
    company_name: org?.name ?? '',
    project_title: (project as any)?.name ?? '',
    contract_number: (project as any)?.contractNumber ?? '',
    submission_date: (project as any)?.submissionDate ?? '',
    page_limit: (project as any)?.pageLimit?.toString() ?? '',
    opportunity_id: (project as any)?.opportunityId ?? '',
    agency_name: (project as any)?.agencyName ?? '',
    current_date: new Date().toISOString().split('T')[0] ?? '',
    proposal_title: (project as any)?.proposalTitle ?? (project as any)?.name ?? '',
  };
};

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const templateId = event.pathParameters?.id;
    if (!templateId) return apiResponse(400, { error: 'Missing template ID' });

    const body = JSON.parse(event.body || '');
    const parsed = ApplyTemplateDTOSchema.safeParse(body);
    if (!parsed.success) {
      return apiResponse(400, { error: 'Validation failed', details: parsed.error.format() });
    }

    const { data } = parsed;
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const template = await getTemplate(orgId, templateId);
    if (!template) return apiResponse(404, { error: 'Template not found' });
    if (template.isArchived) return apiResponse(410, { error: 'Template is archived' });

    const systemMacros = await resolveSystemMacros(data.projectId, orgId);
    const allMacros = { ...systemMacros, ...(data.customMacros ?? {}) };

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

    const finalSections = sections.map(section => ({
      ...section,
      subsections: section.subsections.length > 0
        ? section.subsections
        : [{
            id: `${section.id}-content`,
            title: section.title,
            content: replaceMacros(
              template.sections.find(s => s.id === section.id)?.content ?? '',
              allMacros,
            ),
          }],
    }));

    const proposalDocument: ProposalDocument = {
      proposalTitle: replaceMacros(template.name, allMacros),
      customerName: allMacros.agency_name || null,
      opportunityId: allMacros.opportunity_id || null,
      outlineSummary: template.description
        ? replaceMacros(template.description, allMacros)
        : null,
      sections: finalSections,
    };

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
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('template:apply'))
    .use(httpErrorMiddleware()),
);
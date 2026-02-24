import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { ApplyTemplateDTOSchema, type RFPDocumentContent } from '@auto-rfp/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { getTemplate, replaceMacros } from '@/helpers/template';
import { getProjectById } from '@/helpers/project';

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
    proposal_title: (project as any)?.title ?? (project as any)?.name ?? '',
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

    // Build HTML from template sections — structure is expressed via HTML headings
    const filteredSections = template.sections
      .filter(s => data.includeOptionalSections || s.required)
      .sort((a, b) => a.order - b.order);

    const htmlParts: string[] = [
      `<h1 style="font-size:2em;font-weight:700;margin:0 0 0.5em;color:#1a1a2e;border-bottom:3px solid #4f46e5;padding-bottom:0.3em">${replaceMacros(template.name, allMacros)}</h1>`,
    ];

    if (template.description) {
      htmlParts.push(
        `<div style="background:#eff6ff;border-left:4px solid #4f46e5;padding:1em 1.2em;margin:1em 0;border-radius:0 6px 6px 0"><p style="margin:0;line-height:1.7;color:#374151">${replaceMacros(template.description, allMacros)}</p></div>`,
      );
    }

    for (const section of filteredSections) {
      const sectionTitle = replaceMacros(section.title, allMacros);
      htmlParts.push(
        `<h2 style="font-size:1.4em;font-weight:700;margin:1.5em 0 0.5em;color:#1a1a2e;border-bottom:1px solid #e2e8f0;padding-bottom:0.2em">${sectionTitle}</h2>`,
      );

      if (section.description) {
        htmlParts.push(
          `<p style="margin:0 0 1em;line-height:1.7;color:#374151"><em>${replaceMacros(section.description, allMacros)}</em></p>`,
        );
      }

      if (section.content?.trim()) {
        htmlParts.push(
          `<p style="margin:0 0 1em;line-height:1.7;color:#374151">${replaceMacros(section.content, allMacros)}</p>`,
        );
      }

      // Sections no longer have subsections — content is stored directly in section.content
    }

    const proposalDocument: RFPDocumentContent = {
      title: replaceMacros(template.name, allMacros),
      customerName: allMacros.agency_name || null,
      opportunityId: allMacros.opportunity_id || null,
      outlineSummary: template.description
        ? replaceMacros(template.description, allMacros)
        : null,
      content: htmlParts.join('\n'),
    };

    
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'template',
      resourceId: event.pathParameters?.templateId ?? event.queryStringParameters?.templateId ?? 'unknown',
    });

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
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
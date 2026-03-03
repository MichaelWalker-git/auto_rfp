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
import { getTemplate, loadTemplateHtml, replaceMacros } from '@/helpers/template';
import { getProjectById } from '@/helpers/project';

const resolveSystemMacros = async (
  projectId: string,
  _orgId: string,
): Promise<Record<string, string>> => {
  const project = await getProjectById(projectId);
  const org = (project as any)?.organization;

  return {
    COMPANY_NAME:    org?.name ?? '',
    PROJECT_TITLE:   (project as any)?.name ?? '',
    CONTRACT_NUMBER: (project as any)?.contractNumber ?? '',
    SUBMISSION_DATE: (project as any)?.submissionDate ?? '',
    PAGE_LIMIT:      (project as any)?.pageLimit?.toString() ?? '',
    OPPORTUNITY_ID:  (project as any)?.opportunityId ?? '',
    AGENCY_NAME:     (project as any)?.agencyName ?? '',
    TODAY:           new Date().toISOString().split('T')[0] ?? '',
    PROPOSAL_TITLE:  (project as any)?.title ?? (project as any)?.name ?? '',
    CONTENT:         '',
  };
};

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
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

    const template = await getTemplate(orgId, templateId);
    if (!template) return apiResponse(404, { error: 'Template not found' });
    if (template.isArchived) return apiResponse(410, { error: 'Template is archived' });

    // Load HTML content from S3
    let htmlContent = '';
    if (template.htmlContentKey) {
      try {
        htmlContent = await loadTemplateHtml(template.htmlContentKey);
      } catch (err) {
        console.warn('Failed to load template HTML from S3:', err);
      }
    }

    const systemMacros = await resolveSystemMacros(data.projectId, orgId);
    const allMacros = { ...systemMacros, ...(data.customMacros ?? {}) };

    // Apply macro replacement to the full HTML content
    const resolvedHtml = replaceMacros(htmlContent, allMacros);

    const proposalDocument: RFPDocumentContent = {
      title: replaceMacros(template.name, allMacros),
      customerName: allMacros['AGENCY_NAME'] || null,
      opportunityId: allMacros['OPPORTUNITY_ID'] || null,
      outlineSummary: template.description
        ? replaceMacros(template.description, allMacros)
        : null,
      content: resolvedHtml,
    };

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'template',
      resourceId: templateId,
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

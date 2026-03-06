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
import { buildMacroValues } from '@/helpers/document-generation';

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

    // Build macro values from actual org, project, and opportunity data
    // Note: opportunityId is not available in the DTO, so it will be undefined
    // This means opportunity-specific variables won't be populated during template application
    const systemMacros = await buildMacroValues({
      orgId,
      projectId: data.projectId,
      opportunityId: undefined,
    });
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

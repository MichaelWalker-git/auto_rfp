import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { TEMPLATE_CATEGORY_LABELS, type TemplateCategory } from '@auto-rfp/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
} from '@/middleware/rbac-middleware';
import { listTemplatesByOrg } from '@/helpers/template';
import { listCustomDocumentTypes } from '@/helpers/custom-document-types';

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const [{ items }, customTypes] = await Promise.all([
      listTemplatesByOrg(orgId, { excludeArchived: true, limit: 1000, offset: 0 }),
      listCustomDocumentTypes(orgId),
    ]);

    const countMap = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.category] = (acc[item.category] ?? 0) + 1;
      return acc;
    }, {});

    // Built-in categories
    const categories = Object.entries(TEMPLATE_CATEGORY_LABELS).map(([name, label]) => ({
      name: name as TemplateCategory,
      label,
      count: countMap[name] ?? 0,
    }));

    // Append org-specific custom types (skip any that overlap with built-in)
    const builtInNames = new Set(Object.keys(TEMPLATE_CATEGORY_LABELS));
    for (const ct of customTypes) {
      if (!builtInNames.has(ct.slug)) {
        categories.push({
          name: ct.slug as TemplateCategory,
          label: ct.name,
          count: countMap[ct.slug] ?? 0,
        });
      }
    }

    return apiResponse(200, { categories });
  } catch (err) {
    console.error('Error getting template categories:', err);
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
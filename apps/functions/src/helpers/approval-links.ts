import type { ApprovableEntityType } from '@auto-rfp/core';

/**
 * Build entity-specific review link for email notifications.
 * Returns undefined if required parameters are missing.
 */
export const buildEntityReviewLink = (
  orgId: string,
  projectId: string | undefined,
  entityType: ApprovableEntityType,
  entityId: string,
  opportunityId?: string,
  documentId?: string,
): string | undefined => {
  const base = projectId ? `/organizations/${orgId}/projects/${projectId}` : null;

  switch (entityType) {
    case 'rfp-document':
      // Deep-link to document editor
      return base && opportunityId && documentId
        ? `${base}/opportunities/${opportunityId}/rfp-documents/${documentId}/edit?opportunityId=${opportunityId}`
        : undefined;

    case 'opportunity':
      // Link to opportunity detail page
      return base ? `${base}/opportunities/${entityId}` : undefined;

    case 'brief':
      // Link to opportunity (briefs are viewed within opportunity context)
      return base && opportunityId
        ? `${base}/opportunities/${opportunityId}`
        : undefined;

    case 'submission':
      // Link to opportunity submissions tab
      return base && opportunityId
        ? `${base}/opportunities/${opportunityId}?tab=submissions`
        : undefined;

    case 'foia-request':
    case 'debriefing-request':
      // Link to project dashboard (these entities don't have dedicated detail pages yet)
      return base ? `${base}/dashboard` : undefined;

    case 'content-library':
      // Content library is org-scoped, not project-scoped
      return `/organizations/${orgId}/content-library/${entityId}`;

    case 'template':
      // Templates are org-scoped
      return `/organizations/${orgId}/templates/${entityId}`;

    default: {
      const _exhaustive: never = entityType;
      void _exhaustive;
      return undefined;
    }
  }
};

/**
 * Build review link specifically for RFP documents (legacy document approval system).
 */
export const buildRfpDocumentReviewLink = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
): string => {
  return `/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}/rfp-documents/${documentId}/edit?opportunityId=${opportunityId}`;
};

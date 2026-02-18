import * as Sentry from '@sentry/nextjs';

type BreadcrumbCategory =
  | 'navigation'
  | 'document'
  | 'answer'
  | 'proposal'
  | 'brief'
  | 'project'
  | 'organization'
  | 'knowledge-base'
  | 'search'
  | 'user-action';

interface BreadcrumbData {
  category: BreadcrumbCategory;
  message: string;
  data?: Record<string, string | number | boolean | undefined>;
  level?: Sentry.SeverityLevel;
}

/**
 * Add a custom breadcrumb to Sentry for tracking user actions.
 * Breadcrumbs help trace what the user did before an error occurred.
 */
export function addBreadcrumb({ category, message, data, level = 'info' }: BreadcrumbData): void {
  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Set additional context for errors (e.g., current project, document being viewed)
 */
export function setContext(name: string, context: Record<string, unknown>): void {
  Sentry.setContext(name, context);
}

/**
 * Set a tag for filtering errors in Sentry
 */
export function setTag(key: string, value: string): void {
  Sentry.setTag(key, value);
}

/**
 * Set organization context for Sentry errors.
 * Call this when user enters an organization scope.
 */
export function setOrganizationContext(org: {
  id: string;
  name?: string;
} | null): void {
  if (org) {
    Sentry.setTag('orgId', org.id);
    Sentry.setContext('organization', {
      id: org.id,
      name: org.name,
    });
  } else {
    Sentry.setTag('orgId', 'none');
    Sentry.setContext('organization', null);
  }
}

/**
 * Set project context for Sentry errors.
 * Call this when user enters a project scope.
 */
export function setProjectContext(project: {
  id: string;
  name?: string;
  orgId?: string;
} | null): void {
  if (project) {
    Sentry.setTag('projectId', project.id);
    Sentry.setContext('project', {
      id: project.id,
      name: project.name,
      orgId: project.orgId,
    });
  } else {
    Sentry.setTag('projectId', 'none');
    Sentry.setContext('project', null);
  }
}

/**
 * Clear all navigation context (org, project) when user leaves scope
 */
export function clearNavigationContext(): void {
  Sentry.setTag('orgId', 'none');
  Sentry.setTag('projectId', 'none');
  Sentry.setContext('organization', null);
  Sentry.setContext('project', null);
}

// Pre-built breadcrumb helpers for common actions

export const breadcrumbs = {
  // Document actions
  documentUploadStarted: (fileName: string, kbId: string) =>
    addBreadcrumb({
      category: 'document',
      message: 'Document upload started',
      data: { fileName, kbId },
    }),

  documentUploadCompleted: (documentId: string, fileName: string) =>
    addBreadcrumb({
      category: 'document',
      message: 'Document upload completed',
      data: { documentId, fileName },
    }),

  documentProcessingStarted: (documentId: string) =>
    addBreadcrumb({
      category: 'document',
      message: 'Document processing started',
      data: { documentId },
    }),

  documentDeleted: (documentId: string) =>
    addBreadcrumb({
      category: 'document',
      message: 'Document deleted',
      data: { documentId },
    }),

  // Answer generation
  answerGenerationStarted: (questionId: string, projectId: string) =>
    addBreadcrumb({
      category: 'answer',
      message: 'Answer generation started',
      data: { questionId, projectId },
    }),

  answerGenerationCompleted: (questionId: string, answerId: string) =>
    addBreadcrumb({
      category: 'answer',
      message: 'Answer generation completed',
      data: { questionId, answerId },
    }),

  answerSaved: (answerId: string) =>
    addBreadcrumb({
      category: 'answer',
      message: 'Answer saved',
      data: { answerId },
    }),

  // Proposal actions
  proposalGenerationStarted: (projectId: string) =>
    addBreadcrumb({
      category: 'proposal',
      message: 'Proposal generation started',
      data: { projectId },
    }),

  proposalGenerationCompleted: (proposalId: string) =>
    addBreadcrumb({
      category: 'proposal',
      message: 'Proposal generation completed',
      data: { proposalId },
    }),

  proposalExported: (proposalId: string, format: string) =>
    addBreadcrumb({
      category: 'proposal',
      message: 'Proposal exported',
      data: { proposalId, format },
    }),

  // Executive brief actions
  briefGenerationStarted: (projectId: string) =>
    addBreadcrumb({
      category: 'brief',
      message: 'Executive brief generation started',
      data: { projectId },
    }),

  briefSectionCompleted: (briefId: string, section: string) =>
    addBreadcrumb({
      category: 'brief',
      message: 'Brief section completed',
      data: { briefId, section },
    }),

  // Project actions
  projectCreated: (projectId: string, name: string) =>
    addBreadcrumb({
      category: 'project',
      message: 'Project created',
      data: { projectId, name },
    }),

  projectDeleted: (projectId: string) =>
    addBreadcrumb({
      category: 'project',
      message: 'Project deleted',
      data: { projectId },
    }),

  projectViewed: (projectId: string) =>
    addBreadcrumb({
      category: 'project',
      message: 'Project viewed',
      data: { projectId },
    }),

  // Knowledge base actions
  knowledgeBaseCreated: (kbId: string, name: string) =>
    addBreadcrumb({
      category: 'knowledge-base',
      message: 'Knowledge base created',
      data: { kbId, name },
    }),

  knowledgeBaseDeleted: (kbId: string) =>
    addBreadcrumb({
      category: 'knowledge-base',
      message: 'Knowledge base deleted',
      data: { kbId },
    }),

  // Search actions
  samGovSearchPerformed: (query: string, resultsCount: number) =>
    addBreadcrumb({
      category: 'search',
      message: 'SAM.gov search performed',
      data: { query, resultsCount },
    }),

  opportunityImported: (noticeId: string) =>
    addBreadcrumb({
      category: 'search',
      message: 'Opportunity imported from SAM.gov',
      data: { noticeId },
    }),

  // Question file actions
  questionFileUploaded: (questionFileId: string, fileName: string) =>
    addBreadcrumb({
      category: 'document',
      message: 'Question file uploaded',
      data: { questionFileId, fileName },
    }),

  questionsExtracted: (projectId: string, count: number) =>
    addBreadcrumb({
      category: 'document',
      message: 'Questions extracted from file',
      data: { projectId, questionCount: count },
    }),
};

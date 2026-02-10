import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

import { type ExecutiveBriefItem, ExecutiveBriefItemSchema, } from '@auto-rfp/shared';

import { executiveBriefSK, putExecutiveBrief, } from '../helpers/executive-opportunity-brief';
import { listQuestionFilesByOpportunity } from '../helpers/questionFile';

import { PK_NAME, SK_NAME } from '../constants/common';
import { EXEC_BRIEF_PK } from '../constants/exec-brief';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '../helpers/env';
import { nowIso } from '../helpers/date';


const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const RequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1), // Required - brief is always for a specific opportunity
});


function buildEmptySection() {
  const now = nowIso();
  return { status: 'IDLE' as const, updatedAt: now };
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const { projectId, opportunityId } = RequestSchema.parse(bodyJson);
    const orgId = getOrgId(event);

    console.log('init-executive-brief: Loading question files for', { projectId, opportunityId });

    // Load ALL question files for the opportunity
    const { items: questionFiles } = await listQuestionFilesByOpportunity({ projectId, oppId: opportunityId });

    console.log('init-executive-brief: Found question files', { 
      count: questionFiles.length,
      files: questionFiles.map(qf => ({ 
        questionFileId: qf.questionFileId, 
        textFileKey: qf.textFileKey,
        status: qf.status,
      })),
    });

    // Filter to only processed files with textFileKey
    const processedFiles = questionFiles.filter(qf => qf.textFileKey && qf.status === 'PROCESSED');

    if (processedFiles.length === 0) {
      return apiResponse(400, {
        ok: false,
        error: 'No processed question files found for this opportunity. Please wait for text extraction to complete.',
        totalFiles: questionFiles.length,
        processedFiles: 0,
      });
    }

    // Use the most recent processed file as the primary text source
    // Sort by createdAt descending
    const sortedFiles = processedFiles.sort((a, b) => 
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
    const primaryFile = sortedFiles[0];

    const id = uuidv4()
    const sk = executiveBriefSK(projectId, id);
    const now = nowIso();

    const brief: ExecutiveBriefItem = {
      [PK_NAME]: EXEC_BRIEF_PK,
      [SK_NAME]: sk,
      projectId,
      orgId: orgId || null, // Store orgId for reference
      opportunityId, // Required - brief is always for a specific opportunity
      // NOTE: questionFileId removed - question files are retrieved by opportunityId
      textKey: primaryFile.textFileKey, // Primary text key for convenience
      // Store all text keys for potential multi-document analysis
      allTextKeys: sortedFiles.map(qf => qf.textFileKey).filter(Boolean),
      documentsBucket: DOCUMENTS_BUCKET,
      status: 'IDLE',
      sections: {
        summary: buildEmptySection(),
        deadlines: buildEmptySection(),
        requirements: buildEmptySection(),
        contacts: buildEmptySection(),
        risks: buildEmptySection(),
        pastPerformance: buildEmptySection(),
        scoring: buildEmptySection(),
      },

      createdAt: now,
      updatedAt: now,
    } as any;

    ExecutiveBriefItemSchema.parse(brief);

    await putExecutiveBrief(brief);

    // NOTE: We no longer update the project with executiveBriefId
    // The brief stores projectId and opportunityId, and can be queried by those

    return apiResponse(200, {
      ok: true,
      projectId,
      opportunityId,
      executiveBriefId: sk,
      textKey: brief.textKey,
      allTextKeys: brief.allTextKeys,
      totalQuestionFiles: questionFiles.length,
      processedQuestionFiles: processedFiles.length,
    });
  } catch (err) {
    console.error('init-executive-brief error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('brief:create'))
    .use(httpErrorMiddleware())
);

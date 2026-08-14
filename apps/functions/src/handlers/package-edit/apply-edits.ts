/**
 * POST /package-edit/apply
 *
 * Applies confirmed edits from a proposal run. Synchronous and LLM-free: it
 * performs deterministic, guarded per-target writes (see package-edit-apply.ts).
 * Per requested editId the `before` is re-verified against current content —
 * stale/ambiguous targets are skipped and reported, never overwritten.
 *
 * Permission: proposal:edit (mutates documents + forms). ADMIN + EDITOR only.
 */
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, parseJsonBody } from '@/helpers/api';
import { getOpportunity } from '@/helpers/opportunity';
import { getProposalRunById, markEditsApplied } from '@/helpers/package-edit';
import { applyEdits } from '@/helpers/package-edit-apply';
import { writePackageEditAuditLog } from '@/helpers/package-edit-audit';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { ApplyEditsRequestSchema, ApplyEditsResponseSchema } from '@auto-rfp/core';

const QueryParamsSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  projectId: z.string().min(1, 'projectId is required'),
  opportunityId: z.string().min(1, 'opportunityId is required'),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { success: qOk, data: query, error: qErr } = QueryParamsSchema.safeParse(event.queryStringParameters);
  if (!qOk) {
    return apiResponse(400, { message: 'Invalid query parameters', issues: qErr.issues });
  }
  const { orgId, projectId, opportunityId: oppId } = query;

  const parsedBody = parseJsonBody(event);
  if (parsedBody === undefined) return apiResponse(400, { message: 'Invalid JSON body' });
  const { success, data, error } = ApplyEditsRequestSchema.safeParse(parsedBody);
  if (!success) {
    return apiResponse(400, { message: 'Invalid request body', issues: error.issues });
  }

  const opportunity = await getOpportunity({ orgId, projectId, oppId });
  if (!opportunity) return apiResponse(404, { message: 'Opportunity not found' });

  const run = await getProposalRunById(orgId, projectId, oppId, data.runId);
  if (!run) return apiResponse(404, { message: 'Proposal run not found' });

  // Only apply the requested subset that actually belongs to this run.
  const requested = new Set(data.editIds);
  const edits = (run.proposals ?? []).filter((p) => requested.has(p.editId));
  if (!edits.length) {
    return apiResponse(400, { message: 'None of the requested editIds are in this run' });
  }

  const userId = event.auth?.userId ?? 'system';
  const userName =
    (event.auth?.claims?.name as string | undefined) ??
    (event.auth?.claims?.email as string | undefined) ??
    'system';

  const results = await applyEdits({ edits, orgId, projectId, oppId, userId });

  // Persist which editIds actually applied so a re-poll / "review remaining"
  // surfaces only proposals not yet applied (skipped/failed stay reviewable).
  const appliedEditIds = results.filter((r) => r.status === 'applied').map((r) => r.editId);
  if (appliedEditIds.length > 0) {
    await markEditsApplied(run, appliedEditIds).catch((err) =>
      console.warn('[package-edit-apply] failed to persist applied editIds (non-blocking):', (err as Error)?.message),
    );
  }

  // Audit every applied edit (before→after) — mutations must be logged.
  const byEditId = new Map(edits.map((e) => [e.editId, e]));
  for (const result of results) {
    if (result.status !== 'applied') continue;
    const edit = byEditId.get(result.editId);
    await writePackageEditAuditLog({
      action: 'PACKAGE_EDIT_APPLIED',
      resource: edit?.target.kind === 'FORM' ? 'required_form' : 'rfp_document',
      resourceId:
        edit?.target.kind === 'FORM'
          ? edit.target.formId
          : edit?.target.kind === 'RFP_DOCUMENT' || edit?.target.kind === 'QUESTIONNAIRE'
            ? edit.target.documentId
            : result.editId,
      orgId,
      userId,
      userName,
      after: {
        oppId,
        runId: run.runId,
        editId: result.editId,
        before: edit?.before,
        applied: edit?.after,
        newVersionNumber: result.newVersionNumber,
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
    });
  }

  return apiResponse(200, ApplyEditsResponseSchema.parse({ results }));
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:edit')),
);

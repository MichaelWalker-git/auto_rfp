import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { z } from 'zod';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { FOIA_REQUEST_PK } from '@/constants/organization';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { getFOIARequest } from '@/helpers/foia-request';
import { detectAgencyPortal } from '@/helpers/portal-detection';
import {
  submitToPortal,
  retryPortalSubmission,
  type FOIASubmissionData,
  type PortalSubmissionConfig,
} from '@/helpers/portal-submission';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Request body schema for portal submission
 */
const SubmitToPortalSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  foiaRequestId: z.string().min(1),
  // Optional configuration
  captchaSolver: z
    .object({
      provider: z.enum(['manual', '2captcha', 'anticaptcha']),
      apiKey: z.string().optional(),
    })
    .optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
});

type SubmitToPortalRequest = z.infer<typeof SubmitToPortalSchema>;

export const baseHandler = async (
  event: AuthedEvent
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);
    const { success, data: dto, error } = SubmitToPortalSchema.safeParse(rawBody);

    if (!success) {
      const errorDetails = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const userId = event.auth?.userId || 'unknown';

    // Get the FOIA request
    const foiaRequest = await getFOIARequest(
      dto.orgId,
      dto.projectId,
      dto.opportunityId,
      dto.foiaRequestId
    );

    if (!foiaRequest) {
      return apiResponse(404, {
        message: 'FOIA request not found',
      });
    }

    // Check if portal was detected
    if (!foiaRequest.portalDetected) {
      return apiResponse(400, {
        message: 'No portal detected for this agency - cannot submit via portal',
      });
    }

    // Check if already submitted successfully
    if (foiaRequest.submissionStatus === 'SUBMITTED') {
      return apiResponse(400, {
        message: 'FOIA request already submitted to portal',
        confirmationNumber: foiaRequest.submissionConfirmationNumber,
      });
    }

    // Re-detect portal in case information has been updated
    const portalInfo = await detectAgencyPortal(
      foiaRequest.agencyName,
      foiaRequest.portalBaseUrl
    );

    if (!portalInfo.detected) {
      return apiResponse(400, {
        message: 'Portal detection failed - cannot submit',
      });
    }

    // Build submission data
    const submissionData: FOIASubmissionData = {
      agencyName: foiaRequest.agencyName,
      solicitationNumber: foiaRequest.solicitationNumber,
      contractTitle: foiaRequest.contractTitle,
      description: '', // Will be built from other fields
      requestedDocuments: foiaRequest.requestedDocuments,
      customDocumentRequests: foiaRequest.customDocumentRequests,
      requesterName: foiaRequest.requesterName,
      requesterTitle: foiaRequest.requesterTitle,
      requesterEmail: foiaRequest.requesterEmail,
      requesterPhone: foiaRequest.requesterPhone,
      requesterAddress: foiaRequest.requesterAddress,
      companyName: foiaRequest.companyName,
      awardeeName: foiaRequest.awardeeName,
      awardDate: foiaRequest.awardDate,
      feeLimit: foiaRequest.feeLimit,
    };

    // Build submission config
    const submissionConfig: PortalSubmissionConfig = {
      captchaSolver: dto.captchaSolver,
      maxRetries: dto.maxRetries ?? 3,
      retryDelayMs: 5000,
      timeoutMs: 60000,
    };

    // Update status to pending
    await updateSubmissionStatus(
      dto.orgId,
      dto.projectId,
      dto.opportunityId,
      dto.foiaRequestId,
      'PENDING',
      (foiaRequest.submissionAttempts ?? 0) + 1
    );

    // Attempt submission with retries
    const result = await retryPortalSubmission(
      portalInfo,
      submissionData,
      submissionConfig
    );

    // Update based on result
    if (result.success) {
      await updateSubmissionStatus(
        dto.orgId,
        dto.projectId,
        dto.opportunityId,
        dto.foiaRequestId,
        'SUBMITTED',
        (foiaRequest.submissionAttempts ?? 0) + 1,
        undefined,
        result.confirmationNumber,
        new Date().toISOString()
      );

      setAuditContext(event, {
        action: 'FOIA_REQUEST_SENT',
        resource: 'foia_request',
        resourceId: dto.foiaRequestId,
        changes: {
          after: {
            submissionStatus: 'SUBMITTED',
            confirmationNumber: result.confirmationNumber,
            portal: portalInfo.baseUrl,
          },
        },
      });

      return apiResponse(200, {
        message: 'FOIA request submitted successfully',
        confirmationNumber: result.confirmationNumber,
      });
    } else if (result.requiresManualReview) {
      await updateSubmissionStatus(
        dto.orgId,
        dto.projectId,
        dto.opportunityId,
        dto.foiaRequestId,
        'MANUAL_REVIEW',
        (foiaRequest.submissionAttempts ?? 0) + 1,
        result.error
      );

      setAuditContext(event, {
        action: 'FOIA_REQUEST_FAILED',
        resource: 'foia_request',
        resourceId: dto.foiaRequestId,
        changes: {
          after: {
            submissionStatus: 'MANUAL_REVIEW',
            error: result.error,
          },
        },
      });

      return apiResponse(202, {
        message: 'Portal submission requires manual review',
        error: result.error,
      });
    } else {
      await updateSubmissionStatus(
        dto.orgId,
        dto.projectId,
        dto.opportunityId,
        dto.foiaRequestId,
        'FAILED',
        (foiaRequest.submissionAttempts ?? 0) + 1,
        result.error
      );

      setAuditContext(event, {
        action: 'FOIA_REQUEST_FAILED',
        resource: 'foia_request',
        resourceId: dto.foiaRequestId,
        changes: {
          after: {
            submissionStatus: 'FAILED',
            error: result.error,
          },
        },
      });

      return apiResponse(500, {
        message: 'Portal submission failed',
        error: result.error,
      });
    }
  } catch (err: unknown) {
    console.error('Error in submitToPortal handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

/**
 * Update the submission status of a FOIA request
 */
const updateSubmissionStatus = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  foiaRequestId: string,
  status: 'PENDING' | 'SUBMITTED' | 'FAILED' | 'MANUAL_REVIEW',
  attempts: number,
  error?: string,
  confirmationNumber?: string,
  submittedAt?: string
): Promise<void> => {
  const sortKey = `${orgId}#${projectId}#${opportunityId}#${foiaRequestId}`;
  const now = new Date().toISOString();

  const updateExpression: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = {};

  updateExpression.push('#submissionStatus = :status');
  expressionAttributeNames['#submissionStatus'] = 'submissionStatus';
  expressionAttributeValues[':status'] = status;

  updateExpression.push('#submissionAttempts = :attempts');
  expressionAttributeNames['#submissionAttempts'] = 'submissionAttempts';
  expressionAttributeValues[':attempts'] = attempts;

  updateExpression.push('#lastSubmissionAttemptAt = :lastAttempt');
  expressionAttributeNames['#lastSubmissionAttemptAt'] = 'lastSubmissionAttemptAt';
  expressionAttributeValues[':lastAttempt'] = now;

  updateExpression.push('#updatedAt = :updatedAt');
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':updatedAt'] = now;

  if (error) {
    updateExpression.push('#submissionError = :error');
    expressionAttributeNames['#submissionError'] = 'submissionError';
    expressionAttributeValues[':error'] = error;
  }

  if (confirmationNumber) {
    updateExpression.push('#confirmationNumber = :confirmationNumber');
    expressionAttributeNames['#confirmationNumber'] = 'submissionConfirmationNumber';
    expressionAttributeValues[':confirmationNumber'] = confirmationNumber;
  }

  if (submittedAt && status === 'SUBMITTED') {
    updateExpression.push('#sentAt = :sentAt');
    expressionAttributeNames['#sentAt'] = 'sentAt';
    expressionAttributeValues[':sentAt'] = submittedAt;
  }

  const cmd = new UpdateCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: FOIA_REQUEST_PK,
      [SK_NAME]: sortKey,
    },
    UpdateExpression: `SET ${updateExpression.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  });

  await docClient.send(cmd);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware())
);

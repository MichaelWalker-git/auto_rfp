import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';

import {
  CreateFOIARequestSchema,
  type CreateFOIARequest,
  isFoiaEligibleStatus,
} from '@auto-rfp/core';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { FOIA_REQUEST_PK } from '@/constants/organization';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { getOpportunity } from '@/helpers/opportunity';
import type { DBFOIARequestItem } from '@/types/project-outcome';
import { detectAgencyPortal, getAgencyName } from '@/helpers/portal-detection';
import { findAgencyRecordsPage, scrapeAgencyContactInfo } from '@/helpers/agency-scraper';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

interface AuthContext {
  userId?: string;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2 & { authContext?: AuthContext }
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);
    const { success, data: dto, error } = CreateFOIARequestSchema.safeParse(rawBody);

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
    const userId = event.authContext?.userId || 'unknown';

    // Verify the specific opportunity has a WON or LOST outcome
    const outcomeEligible = await checkEligibleOutcome(dto.orgId, dto.projectId, dto.opportunityId);
    if (!outcomeEligible) {
      return apiResponse(400, {
        message: 'FOIA request can only be created for opportunities with a WON or LOST outcome',
      });
    }

    // Detect portal information
    const agencyName = getAgencyName(dto.agencyName);
    const portalInfo = await detectAgencyPortal(agencyName, dto.agencyDomain);
    
    // Update the DTO with portal information
    dto.portalDetected = portalInfo.detected;
    dto.portalType = portalInfo.type;
    dto.portalBaseUrl = portalInfo.baseUrl;
    dto.portalRecordTypeField = portalInfo.recordTypeField;
    dto.portalRecordTypeValue = portalInfo.recordTypeValue;

    // If no portal detected, try to find agency's records page for fallback
    if (!portalInfo.detected) {
      const recordsPageUrl = await findAgencyRecordsPage(agencyName);
      if (recordsPageUrl) {
        const contactInfo = await scrapeAgencyContactInfo(agencyName, recordsPageUrl);
        // Update any available contact information from the scraped data
        if (contactInfo.coordinatorEmail) {
          dto.agencyFOIAEmail = contactInfo.coordinatorEmail;
        }
        if (contactInfo.statutoryCitation) {
          // We'll handle the statutory citation in the FOIA letter generation
          // This will be used to generate the correct statutory language
        }
      }
    }

    const foiaRequest = await createFOIARequest(dto, userId);

    // Log audit event for portal detection
    setAuditContext(event, {
      action: portalInfo.detected ? 'PORTAL_DETECTED' : 'EMAIL_FALLBACK_INITIATED',
      resource: 'foia-request',
      resourceId: foiaRequest.foiaId,
      changes: {
        after: {
          portalDetected: portalInfo.detected,
          portalType: portalInfo.type,
          portalBaseUrl: portalInfo.baseUrl,
          agencyName: agencyName,
        },
      },
    });

    return apiResponse(201, { foiaRequest });
  } catch (err: unknown) {
    console.error('Error in createFOIARequest handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

const checkEligibleOutcome = async (orgId: string, projectId: string, opportunityId: string): Promise<boolean> => {
  const result = await getOpportunity({ orgId, projectId, oppId: opportunityId });
  return isFoiaEligibleStatus(result?.item?.status);
};

export async function createFOIARequest(
  dto: CreateFOIARequest,
  userId: string
): Promise<DBFOIARequestItem> {
  const now = new Date().toISOString();
  const foiaId = uuidv4();

  // Create sort key: orgId#projectId#opportunityId#foiaId
  const sortKey = `${dto.orgId}#${dto.projectId}#${dto.opportunityId}#${foiaId}`;

  const foiaItem: DBFOIARequestItem = {
    [PK_NAME]: FOIA_REQUEST_PK,
    [SK_NAME]: sortKey,
    foiaId,
    id: foiaId,
    projectId: dto.projectId,
    orgId: dto.orgId,
    opportunityId: dto.opportunityId,
    agencyName: dto.agencyName,
    agencyFOIAEmail: dto.agencyFOIAEmail,
    agencyFOIAAddress: dto.agencyFOIAAddress,
    solicitationNumber: dto.solicitationNumber,
    contractTitle: dto.contractTitle,
    requestedDocuments: dto.requestedDocuments,
    customDocumentRequests: dto.customDocumentRequests ?? [],
    feeLimit: dto.feeLimit ?? 0,
    companyName: dto.companyName,
    awardeeName: dto.awardeeName,
    awardDate: dto.awardDate,
    requesterName: dto.requesterName,
    requesterTitle: dto.requesterTitle,
    requesterEmail: dto.requesterEmail,
    requesterPhone: dto.requesterPhone,
    requesterAddress: dto.requesterAddress,
    requestedBy: userId,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    portalDetected: dto.portalDetected || false,
    portalType: dto.portalType || 'Unknown',
    portalBaseUrl: dto.portalBaseUrl || '',
    portalRecordTypeField: dto.portalRecordTypeField || '',
    portalRecordTypeValue: dto.portalRecordTypeValue || '',
  };

  const cmd = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: foiaItem,
  });

  await docClient.send(cmd);

  return foiaItem;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);

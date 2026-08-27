import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
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
} from '@/middleware/rbac-middleware';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { getOpportunity } from '@/helpers/opportunity';
import { getOrgPrimaryContact } from '@/helpers/org-contact';
import type { DBFOIARequestItem } from '@/types/project-outcome';
import type { OrgPrimaryContactItem } from '@auto-rfp/core';
import { generateFOIALetter, validateLetterFields } from '@/helpers/foia-letter';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Letter generation lives in `@/helpers/foia-letter` so the scheduled reconciler
 * and the send path can compose a letter without invoking this handler. These
 * re-exports keep the existing import sites and tests working unchanged.
 */
export { generateFOIALetter, validateLetterFields };
export type { LetterJurisdictionContext } from '@/helpers/foia-letter';

const GenerateFOIALetterRequestSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  projectId: z.string().min(1, 'projectId is required'),
  opportunityId: z.string().min(1, 'opportunityId is required'),
  foiaRequestId: z.string().min(1, 'foiaRequestId is required'),
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const rawBody = JSON.parse(event.body || '{}');
    const { success, data, error } = GenerateFOIALetterRequestSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
    }

    const { orgId, projectId, opportunityId, foiaRequestId } = data;

    const [foiaRequest, primaryContact, outcome] = await Promise.all([
      getFOIARequest(orgId, projectId, opportunityId, foiaRequestId),
      getOrgPrimaryContact(orgId).catch(() => null),
      getProjectOutcome(orgId, projectId, opportunityId).catch(() => null),
    ]);

    if (!foiaRequest) {
      return apiResponse(404, { message: 'FOIA request not found' });
    }

    // Enrich the FOIA request with primary contact data as fallback
    // for any missing requester fields
    const enrichedRequest = enrichWithPrimaryContact(foiaRequest, primaryContact);

    const missingFields = validateLetterFields(enrichedRequest);
    if (missingFields.length > 0) {
      return apiResponse(400, {
        message: 'FOIA request is missing required fields for letter generation',
        missingFields,
      });
    }

    const letter = generateFOIALetter(enrichedRequest, {
      jurisdiction: outcome?.jurisdiction,
      state: outcome?.state,
    });

    return apiResponse(200, { letter });
  } catch (err: unknown) {
    console.error('Error in generateFOIALetter handler:', err);

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

/**
 * Enrich a FOIA request with org primary contact data.
 * Only fills in fields that are missing or empty — never overwrites user-provided data.
 */
const enrichWithPrimaryContact = (
  request: DBFOIARequestItem,
  contact: OrgPrimaryContactItem | null,
): DBFOIARequestItem => {
  if (!contact) return request;

  return {
    ...request,
    requesterName: request.requesterName || contact.name,
    requesterEmail: request.requesterEmail || contact.email,
    requesterPhone: request.requesterPhone || contact.phone || request.requesterPhone,
    requesterAddress: request.requesterAddress || contact.address || request.requesterAddress,
  };
};

async function getFOIARequest(
  orgId: string,
  projectId: string,
  opportunityId: string,
  foiaRequestId: string
): Promise<DBFOIARequestItem | null> {
  const sortKey = `${orgId}#${projectId}#${opportunityId}#${foiaRequestId}`;

  const cmd = new GetCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: FOIA_REQUEST_PK,
      [SK_NAME]: sortKey,
    },
  });

  const result = await docClient.send(cmd);
  return result.Item as DBFOIARequestItem | null;
}

async function getProjectOutcome(
  orgId: string,
  projectId: string,
  opportunityId: string
): Promise<{ jurisdiction?: 'FEDERAL' | 'STATE'; state?: string } | null> {
  const result = await getOpportunity({ orgId, projectId, oppId: opportunityId });
  if (!result?.item) return null;
  return {
    jurisdiction: result.item.jurisdiction,
    state: result.item.state ?? undefined,
  };
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware())
);

import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { z } from 'zod';

import { FOIA_DOCUMENT_DESCRIPTIONS, type FOIADocumentType } from '@auto-rfp/core';
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
import { getOrgPrimaryContact } from '@/helpers/org-contact';
import type { DBFOIARequestItem } from '@/types/project-outcome';
import type { OrgPrimaryContactItem } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const GenerateFOIALetterRequestSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  projectId: z.string().min(1, 'projectId is required'),
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

    const { orgId, projectId, foiaRequestId } = data;

    const [foiaRequest, primaryContact] = await Promise.all([
      getFOIARequest(orgId, projectId, foiaRequestId),
      getOrgPrimaryContact(orgId).catch(() => null),
    ]);

    if (!foiaRequest) {
      return apiResponse(404, { message: 'FOIA request not found' });
    }

    // Enrich the FOIA request with primary contact data as fallback
    // for any missing requester fields
    const enrichedRequest = enrichWithPrimaryContact(foiaRequest, primaryContact);

    const letter = generateFOIALetter(enrichedRequest);

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
    requesterPhone: request.requesterPhone || contact.phone || undefined,
    requesterAddress: request.requesterAddress || contact.address || undefined,
  };
};

async function getFOIARequest(
  orgId: string,
  projectId: string,
  foiaRequestId: string
): Promise<DBFOIARequestItem | null> {
  const sortKey = `${orgId}#${projectId}#${foiaRequestId}`;

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

/**
 * Generates a simplified, practitioner-oriented FOIA request letter.
 */
export const generateFOIALetter = (request: DBFOIARequestItem): string => {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const numberedDocuments = request.requestedDocuments
    .map((doc: FOIADocumentType, idx: number) => `   ${idx + 1}. ${FOIA_DOCUMENT_DESCRIPTIONS[doc]}`)
    .join('\n');

  const customDocuments = request.customDocumentRequests?.length
    ? request.customDocumentRequests
        .map((desc: string, idx: number) => `   ${request.requestedDocuments.length + idx + 1}. ${desc}`)
        .join('\n')
    : '';

  const allDocuments = customDocuments
    ? `${numberedDocuments}\n${customDocuments}`
    : numberedDocuments;

  // Build the "pertains to" line with optional award date
  const awardDateClause = request.awardDate
    ? `, awarded on or around ${request.awardDate}`
    : '';
  const titleClause = request.contractTitle
    ? `, titled ${request.contractTitle}`
    : '';
  const pertainsLine = `This request pertains to Solicitation No. ${request.solicitationNumber}${titleClause}${awardDateClause}.`;

  // Build the company/offeror paragraph
  const companyClause = request.companyName
    ? `My company, ${request.companyName}${request.samUEI ? ` (SAM UEI: ${request.samUEI})` : ''}, submitted a proposal`
    : 'I submitted a proposal';
  const awardeeClause = request.awardeeName
    ? ` The contract was awarded to ${request.awardeeName}.`
    : '';

  // Fee limit line (only if > $0)
  const feeLine = request.feeLimit > 0
    ? `\nI am willing to pay up to $${request.feeLimit.toFixed(2)} in fees associated with this request. Please contact me before incurring any costs in excess of this amount.\n`
    : '';

  return `${today}

FOIA Requester Service Center
${request.agencyName}
${request.agencyFOIAAddress || '[Agency FOIA Office Address]'}
${request.agencyFOIAEmail ? `Email: ${request.agencyFOIAEmail}` : ''}

Dear FOIA Officer,

This is a request under the Freedom of Information Act (5 U.S.C. Section 552).

${pertainsLine}

I am submitting this request on behalf of an unsuccessful offeror on the above-referenced solicitation. ${companyClause} in response to this solicitation and was not selected for award.${awardeeClause}

I request that a copy of the following documents be provided to me:

${allDocuments}
${feeLine}
I am also including an email address for electronic delivery of responsive records: ${request.requesterEmail}

Sincerely,

${request.requesterName}
${request.requesterAddress || '[Address]'}
Email: ${request.requesterEmail}${request.requesterPhone ? `\nPhone: ${request.requesterPhone}` : ''}`;
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware())
);

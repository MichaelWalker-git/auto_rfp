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

/**
 * Formats a date string into a human-readable format for letters.
 * Handles both ISO dates ("2026-01-15") and already-formatted strings ("January 15, 2026").
 */
const formatDateForLetter = (dateStr: string): string => {
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return dateStr;
  // Offset UTC parse so the date doesn't shift due to timezone
  const utc = new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  return utc.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

/** Fields on the FOIA request record that must be populated to generate a letter. */
const REQUIRED_LETTER_FIELDS = [
  'agencyName',
  'agencyFOIAEmail',
  'agencyFOIAAddress',
  'solicitationNumber',
  'contractTitle',
  'awardDate',
  'companyName',
  'requesterName',
  'requesterTitle',
  'requesterEmail',
  'requesterPhone',
  'requesterAddress',
] as const;

export const validateLetterFields = (
  request: DBFOIARequestItem,
): string[] => {
  const missing: string[] = [];
  for (const field of REQUIRED_LETTER_FIELDS) {
    if (!request[field]) {
      missing.push(field);
    }
  }
  // requestedDocuments must have at least one entry
  if (!request.requestedDocuments || request.requestedDocuments.length === 0) {
    missing.push('requestedDocuments');
  }
  return missing;
};

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

    const [foiaRequest, primaryContact] = await Promise.all([
      getFOIARequest(orgId, projectId, opportunityId, foiaRequestId),
      getOrgPrimaryContact(orgId).catch(() => null),
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

  // Build the "pertains to" line
  const pertainsLine = `This request pertains to Solicitation No. ${request.solicitationNumber}, titled ${request.contractTitle}, awarded on or about ${formatDateForLetter(request.awardDate)}.`;

  // Build the company/offeror paragraph
  const companyClause = `My company, ${request.companyName}, submitted a proposal`;
  const awardeeClause = request.awardeeName ? ` The contract was awarded to ${request.awardeeName}.` : '';

  // Fee limit line — always included
  const feeLine = request.feeLimit > 0
    ? `\nI am willing to pay up to $${request.feeLimit.toFixed(2)} in fees associated with this request. Please contact me before incurring any costs in excess of this amount.\n`
    : '\nI request a fee waiver for this request. If a fee waiver is not granted, please contact me before incurring any costs.\n';

  return `${today}

FOIA Requester Service Center
${request.agencyName}
${request.agencyFOIAAddress}
Email: ${request.agencyFOIAEmail}

Dear FOIA Officer,

This is a request under the Freedom of Information Act (5 U.S.C. Section 552).

${pertainsLine}

I am submitting this request on behalf of an unsuccessful offeror on the above-referenced solicitation. ${companyClause} in response to this solicitation and was not selected for award.${awardeeClause}

I request that a copy of the following documents be provided to me:

${allDocuments}
${feeLine}
I request that responsive records be provided in electronic format (PDF preferred) via email to ${request.requesterEmail}.

Sincerely,

${request.requesterName}
${request.requesterTitle}
${request.companyName}
${request.requesterAddress}
Email: ${request.requesterEmail}
Phone: ${request.requesterPhone}`;
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware())
);

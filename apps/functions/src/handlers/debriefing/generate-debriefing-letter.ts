import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { GenerateDebriefingLetterRequestSchema } from '@auto-rfp/core';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { DEBRIEFING_PK } from '@/constants/organization';
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
import type { DBDebriefingItem } from '@/types/project-outcome';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Formats a date string into a human-readable format for letters.
 * Handles both ISO dates ("2026-01-15") and already-formatted strings ("January 15, 2026").
 */
const formatDateForLetter = (dateStr: string): string => {
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return dateStr;
  const utc = new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  return utc.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

/** Fields on the debriefing record that must be populated to generate a letter. */
const REQUIRED_LETTER_FIELDS = [
  'solicitationNumber',
  'contractTitle',
  'awardNotificationDate',
  'contractingOfficerEmail',
  'requesterName',
  'requesterTitle',
  'requesterEmail',
  'requesterPhone',
  'requesterAddress',
  'companyName',
] as const;

export const validateLetterFields = (
  debriefing: DBDebriefingItem,
): string[] => {
  const missing: string[] = [];
  for (const field of REQUIRED_LETTER_FIELDS) {
    if (!debriefing[field]) {
      missing.push(field);
    }
  }
  return missing;
};

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const rawBody = JSON.parse(event.body || '{}');
    const { success, data, error } = GenerateDebriefingLetterRequestSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
    }

    const { orgId, projectId, opportunityId, debriefingId } = data;

    const debriefing = await getDebriefing(orgId, projectId, opportunityId, debriefingId);

    if (!debriefing) {
      return apiResponse(404, { message: 'Debriefing request not found' });
    }

    const missingFields = validateLetterFields(debriefing);
    if (missingFields.length > 0) {
      return apiResponse(400, {
        message: 'Debriefing record is missing required fields for letter generation',
        missingFields,
      });
    }

    const letter = generateDebriefingLetter(debriefing);

    return apiResponse(200, { letter });
  } catch (err: unknown) {
    console.error('Error in generateDebriefingLetter handler:', err);

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

const getDebriefing = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  debriefingId: string
): Promise<DBDebriefingItem | null> => {
  const sortKey = `${orgId}#${projectId}#${opportunityId}#${debriefingId}`;

  const cmd = new GetCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: DEBRIEFING_PK,
      [SK_NAME]: sortKey,
    },
  });

  const result = await docClient.send(cmd);
  return result.Item as DBDebriefingItem | null;
};

/**
 * Generates a formal post-award debriefing request letter using FAR 15.506 language.
 * All required fields are guaranteed to be present (validated before calling this function).
 */
export const generateDebriefingLetter = (debriefing: DBDebriefingItem): string => {
  const salutation = debriefing.contractingOfficerName
    ? `Dear ${debriefing.contractingOfficerName},`
    : 'Dear Contracting Officer,';

  return `${salutation}

Pursuant to FAR 15.506, I am writing on behalf of ${debriefing.companyName} to formally request a post-award debriefing regarding Solicitation No. ${debriefing.solicitationNumber}, ${debriefing.contractTitle}. We received notification of the award on ${formatDateForLetter(debriefing.awardNotificationDate)}.${debriefing.awardedOrganization ? ` It is my understanding that the contract was awarded to ${debriefing.awardedOrganization}.` : ''}

${debriefing.companyName} submitted a proposal in response to this solicitation and was not selected for award. Under FAR 15.506(a), an unsuccessful offeror may request a debriefing by submitting a written request within three (3) days after receipt of notification of contract award.

We respectfully request that the debriefing address the following areas, as outlined in FAR 15.506(d):

   1. The Government's evaluation of the significant weaknesses or deficiencies in our proposal
   2. The overall evaluated cost or price and technical rating of our proposal and the awardee's proposal
   3. The overall ranking of all offerors, when any ranking was developed during the source selection
   4. A summary of the rationale for award
   5. Whether the source selection procedures in the solicitation and applicable regulations were followed

We respectfully request that the debriefing be provided in written format pursuant to FAR 15.506(b).

Thank you for your consideration of this request. Please do not hesitate to contact me if you require any additional information.

Sincerely,

${debriefing.requesterName}
${debriefing.requesterTitle}
${debriefing.companyName}
${debriefing.requesterAddress}
Email: ${debriefing.requesterEmail}
Phone: ${debriefing.requesterPhone}`;
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware())
);

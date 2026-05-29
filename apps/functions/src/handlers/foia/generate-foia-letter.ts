import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

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
import type { DBFOIARequestItem } from '@/types/project-outcome';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId, projectId, foiaRequestId } = JSON.parse(event.body || '');

    if (!orgId || !projectId || !foiaRequestId) {
      return apiResponse(400, {
        message: 'Missing required parameters: orgId, projectId, or foiaRequestId',
      });
    }

    const foiaRequest = await getFOIARequest(orgId, projectId, foiaRequestId);

    if (!foiaRequest) {
      return apiResponse(404, { message: 'FOIA request not found' });
    }

    const letter = generateFOIALetter(foiaRequest);

    return apiResponse(200, { letter });
  } catch (err: unknown) {
    console.error('Error in generateFOIALetter handler:', err);

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
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

export function generateFOIALetter(request: DBFOIARequestItem): string {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const documentDescriptions = request.requestedDocuments
    .map((doc: FOIADocumentType) => getDocumentDescription(doc))
    .join('\n');

  return `${today}

FOIA Request

To: FOIA Officer
${request.agencyName}
${request.agencyFOIAAddress || '[Agency FOIA Office Address]'}

From: ${request.requesterName}
${request.requesterAddress || '[Requester Address]'}
Email: ${request.requesterEmail}
${request.requesterPhone ? `Phone: ${request.requesterPhone}` : ''}

Re: Freedom of Information Act Request
Solicitation Number: ${request.solicitationNumber}
${request.contractNumber ? `Contract Number: ${request.contractNumber}` : ''}

Dear FOIA Officer:

Pursuant to the Freedom of Information Act (FOIA), 5 U.S.C. § 552, I am requesting access to and copies of the following records related to the above-referenced solicitation:

REQUESTED DOCUMENTS:
${documentDescriptions}

I am requesting these records for the purpose of understanding the evaluation process and improving future proposal submissions. I am willing to pay reasonable duplication fees for these documents. If the fees exceed $100, please contact me before proceeding.

To assist in locating these records, please note that this request pertains to Solicitation Number ${request.solicitationNumber}${request.contractNumber ? ` and Contract Number ${request.contractNumber}` : ''}.

If you determine that any portion of the requested records is exempt from disclosure, please provide me with the following:
1. An index of the documents or portions withheld
2. The specific exemption(s) justifying the withholding
3. A brief explanation of how the exemption applies

If you have any questions regarding this request, please contact me at ${request.requesterEmail}${request.requesterPhone ? ` or ${request.requesterPhone}` : ''}.

I look forward to receiving your response within 20 working days, as required by the FOIA.

Sincerely,

${request.requesterName}
${request.requesterEmail}`;
}

function getDocumentDescription(docType: FOIADocumentType): string {
  const description = FOIA_DOCUMENT_DESCRIPTIONS[docType];
  return `• ${description}`;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware())
);

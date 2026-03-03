import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { z } from 'zod';

import { FOIA_DOCUMENT_DESCRIPTIONS, type FOIADocumentType, type RequesterCategory } from '@auto-rfp/core';
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
 * Fee category descriptions per FOIA fee schedule (5 U.S.C. § 552(a)(4)(A)(ii))
 */
const FEE_CATEGORY_DESCRIPTIONS: Record<RequesterCategory, string> = {
  COMMERCIAL: 'a commercial use requester. I understand that as a commercial use requester, I may be charged reasonable search, review, and duplication fees',
  EDUCATIONAL: 'an educational institution requester. I am affiliated with an educational institution and this request is made for scholarly purposes, not for commercial use. Under the FOIA fee provisions, I am entitled to receive the first 100 pages of duplication at no charge and should not be charged search fees',
  NEWS_MEDIA: 'a representative of the news media. This request is made for news-gathering purposes and not for commercial use. Under the FOIA fee provisions, I am entitled to receive the first 100 pages of duplication at no charge and should not be charged search fees',
  OTHER: 'an "all other" requester under the FOIA fee categories. I understand that I am entitled to two hours of search time and the first 100 pages of duplication at no charge',
};

/**
 * Generates a properly formatted FOIA request letter following federal best practices.
 *
 * References:
 * - 5 U.S.C. § 552 (Freedom of Information Act)
 * - 5 U.S.C. § 552(a)(3)(A) — obligation to make records available
 * - 5 U.S.C. § 552(a)(4)(A) — fee schedule and fee waivers
 * - 5 U.S.C. § 552(a)(6)(A) — 20 business day response requirement
 * - 5 U.S.C. § 552(b) — exemptions (referenced for segregability)
 * - DOJ Office of Information Policy guidance
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

  const feeCategory = FEE_CATEGORY_DESCRIPTIONS[request.requesterCategory] ?? FEE_CATEGORY_DESCRIPTIONS.OTHER;

  const feeWaiverSection = request.requestFeeWaiver
    ? `
FEE WAIVER REQUEST

Pursuant to 5 U.S.C. § 552(a)(4)(A)(iii), I request a waiver of all fees associated with this request. Disclosure of the requested information is in the public interest because it is likely to contribute significantly to public understanding of the operations or activities of the government and is not primarily in the commercial interest of the requester.${request.feeWaiverJustification ? `\n\nSpecifically: ${request.feeWaiverJustification}` : ''}

In the event that my fee waiver request is denied, I am willing to pay fees up to $${request.feeLimit.toFixed(2)}. Please contact me before incurring any costs in excess of this amount.
`
    : `
FEES

For purposes of the fee assessment, I am ${feeCategory}. I am willing to pay fees up to $${request.feeLimit.toFixed(2)} for the processing of this request. Please contact me before incurring any costs in excess of this amount.
`;

  const contractRef = request.contractNumber
    ? `Contract Number: ${request.contractNumber}\n`
    : '';

  const phoneRef = request.requesterPhone
    ? `Phone: ${request.requesterPhone}\n`
    : '';

  return `${today}

VIA ${request.agencyFOIAEmail ? 'EMAIL' : 'MAIL'}

FOIA/PA Officer
${request.agencyName}
${request.agencyFOIAAddress || '[Agency FOIA Office Address]'}
${request.agencyFOIAEmail ? `Email: ${request.agencyFOIAEmail}` : ''}

    Re: Freedom of Information Act Request
        Solicitation Number: ${request.solicitationNumber}
        ${contractRef}Agency: ${request.agencyName}

Dear FOIA Officer:

This is a request under the Freedom of Information Act (FOIA), 5 U.S.C. § 552, as amended. Pursuant to 5 U.S.C. § 552(a)(3)(A), I respectfully request access to and copies of the following records related to the above-referenced procurement:

RECORDS REQUESTED

I request all records, documents, memoranda, evaluations, correspondence, and other materials related to Solicitation Number ${request.solicitationNumber}${request.contractNumber ? ` (Contract Number: ${request.contractNumber})` : ''}, including but not limited to:

${allDocuments}

To assist your office in locating responsive records, please note that this request pertains specifically to the source selection and evaluation process for the above-referenced solicitation issued by ${request.agencyName}.

DESCRIPTION OF REQUESTER AND PURPOSE

I am submitting this request on behalf of an unsuccessful offeror on the above-referenced solicitation. The purpose of this request is to understand the evaluation criteria, scoring methodology, and basis for the award decision in order to improve future proposal submissions and to ensure the integrity of the competitive procurement process.
${feeWaiverSection}
FORMAT OF RECORDS

Pursuant to the Electronic Freedom of Information Act Amendments of 1996, I request that responsive records be provided in electronic format (PDF preferred) via email to ${request.requesterEmail}. If electronic delivery is not possible, please provide paper copies to the address below.

SEGREGABILITY

If any responsive records or portions thereof are determined to be exempt from disclosure under any of the nine FOIA exemptions (5 U.S.C. § 552(b)(1)-(9)), I request that your office:

   1. Release all reasonably segregable, non-exempt portions of each responsive record, as required by 5 U.S.C. § 552(b);
   2. Provide a detailed Vaughn index identifying each record or portion withheld, the specific exemption(s) claimed, and a particularized explanation of how each exemption applies to the withheld material;
   3. Note whether any deleted information is disputed or whether the deletion was made at the request of another agency.

RESPONSE DEADLINE

As you are aware, the FOIA requires that you respond to this request within twenty (20) business days of receipt, pursuant to 5 U.S.C. § 552(a)(6)(A)(i). If you anticipate that processing this request will take longer than the statutory period, please notify me promptly so that we may discuss narrowing the scope of the request or other accommodations.

APPEAL RIGHTS

I understand that if this request is denied in whole or in part, I have the right to appeal that decision to the head of the agency (or designee) within 90 days of the date of the denial, pursuant to 5 U.S.C. § 552(a)(6)(A)(i). I also understand that I may seek judicial review under 5 U.S.C. § 552(a)(4)(B) and that I may contact the Office of Government Information Services (OGIS) at the National Archives and Records Administration for mediation services.

CONTACT INFORMATION

If you have any questions regarding this request, require clarification, or need to discuss fee arrangements, please contact me at the information below:

   ${request.requesterName}
   ${request.requesterAddress || '[Address]'}
   Email: ${request.requesterEmail}
   ${phoneRef}
Thank you for your prompt attention to this request. I look forward to receiving your determination within the statutory timeframe.

Respectfully submitted,


${request.requesterName}
${request.requesterEmail}${request.requesterPhone ? `\n${request.requesterPhone}` : ''}
Date: ${today}`;
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware())
);

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import {
  authContextMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  httpErrorMiddleware,
} from '../middleware/rbac-middleware';

import { readPlainSecret } from '../helpers/secret';
import { httpsGetBuffer } from '../helpers/samgov';

const SAM_GOV_API_KEY_SECRET_ID = requireEnv('SAM_GOV_API_KEY_SECRET_ID');

const ALLOWED_SAM_DOMAINS = [
  'api.sam.gov',
  'sam.gov',
];

// reuse sockets across invocations
const httpsAgent = new https.Agent({ keepAlive: true });

type RequestBody = {
  descriptionUrl: string;
};

let cachedApiKey: string | null = null;

async function getApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  cachedApiKey = await readPlainSecret(SAM_GOV_API_KEY_SECRET_ID);
  return cachedApiKey;
}

function isValidSamGovUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    
    // Must be HTTPS
    if (url.protocol !== 'https:') {
      return false;
    }
    
    // Must be from allowed SAM.gov domains
    const hostname = url.hostname.toLowerCase();
    const isAllowed = ALLOWED_SAM_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith(`.${domain}`)
    );
    
    return isAllowed;
  } catch {
    return false;
  }
}

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  let body: RequestBody;
  try {
    body = JSON.parse(event.body);
  } catch {
    return apiResponse(400, { message: 'Invalid JSON body' });
  }

  if (!body.descriptionUrl) {
    return apiResponse(400, { message: 'descriptionUrl is required' });
  }

  if (!isValidSamGovUrl(body.descriptionUrl)) {
    return apiResponse(400, { 
      message: 'Invalid descriptionUrl: must be from sam.gov domain',
      allowedDomains: ALLOWED_SAM_DOMAINS,
    });
  }

  const apiKey = await getApiKey();

  let url: URL;
  try {
    url = new URL(body.descriptionUrl);
  } catch {
    return apiResponse(400, { message: 'Invalid descriptionUrl' });
  }

  url.searchParams.set('api_key', apiKey);

  try {
    const { buf, contentType } = await httpsGetBuffer(url, { httpsAgent });
    
    // If it's JSON, parse and return it
    if (contentType?.includes('json')) {
      const jsonData = JSON.parse(buf.toString('utf-8'));
      return apiResponse(200, jsonData);
    }
    
    // Otherwise return binary data
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: buf.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error('Error fetching from SAM.gov:', error);
    return apiResponse(500, {
      message: 'Failed to fetch description from SAM.gov',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);
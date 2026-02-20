import type { APIGatewayAuthorizerResult } from 'aws-lambda';
import {
  CognitoJwtVerifier,
} from 'aws-jwt-verify';
import { requireEnv } from '@/helpers/env';

const USER_POOL_ID = requireEnv('COGNITO_USER_POOL_ID');
const REGION = requireEnv('REGION', 'us-east-1');

// Verifier that expects valid access tokens from the Cognito user pool
const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'id',
  clientId: null, // accept any client
});

interface WsAuthorizerEvent {
  type: string;
  methodArn: string;
  queryStringParameters?: Record<string, string>;
}

export const handler = async (event: WsAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  const token = event.queryStringParameters?.token ?? '';

  try {
    const payload = await verifier.verify(token);

    return {
      principalId: payload.sub,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: event.methodArn,
          },
        ],
      },
      context: {
        sub: payload.sub,
        email: (payload['email'] as string | undefined) ?? '',
      },
    };
  } catch {
    return {
      principalId: 'unauthorized',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Deny',
            Resource: event.methodArn,
          },
        ],
      },
    };
  }
};

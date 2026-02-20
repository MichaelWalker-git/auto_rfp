import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { WS_CONNECTION_TTL_SECONDS } from '@/constants/collaboration';
import { putWsConnection } from '@/helpers/collaboration';

// The WebSocket event type doesn't expose queryStringParameters in its type definition,
// but API Gateway does pass them at runtime. We cast to access them safely.
interface WsConnectEvent extends APIGatewayProxyWebsocketEventV2 {
  queryStringParameters?: Record<string, string>;
}

export const handler = async (event: WsConnectEvent) => {
  const { connectionId } = event.requestContext;
  // orgId and projectId are passed as query params on the WebSocket upgrade URL
  const { projectId, orgId } = event.queryStringParameters ?? {};

  if (!connectionId || !projectId || !orgId) {
    return { statusCode: 400, body: 'Missing required query params: projectId, orgId' };
  }

  // For WebSocket Lambda authorizers, the authorizer context is available at
  // event.requestContext.authorizer (not nested under .jwt or .claims)
  const requestContext = event.requestContext as unknown as {
    authorizer?: {
      // Lambda authorizer passes context fields directly
      sub?: string;
      email?: string;
      principalId?: string;
      // Some setups nest under claims
      claims?: Record<string, string>;
    };
  };

  const authorizer = requestContext?.authorizer ?? {};
  // Try direct context fields first (Lambda authorizer), then nested claims
  const userId =
    authorizer.sub ??
    authorizer.principalId ??
    authorizer.claims?.['sub'] ??
    '';

  const displayName =
    authorizer.email ??
    authorizer.claims?.['email'] ??
    userId;

  if (!userId) {
    console.error('ws-connect: userId is empty. authorizer context:', JSON.stringify(authorizer));
    return { statusCode: 401, body: 'Unauthorized: userId not found in authorizer context' };
  }

  const ttl = Math.floor(Date.now() / 1000) + WS_CONNECTION_TTL_SECONDS;

  await putWsConnection(connectionId, {
    connectionId,
    projectId,
    orgId,
    userId,
    displayName,
    ttl,
  });

  return { statusCode: 200, body: 'Connected' };
};

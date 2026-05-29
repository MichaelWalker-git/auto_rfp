import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { requireEnv } from '@/helpers/env';
import { getWsConnection, upsertPresence, listPresence } from '@/helpers/collaboration';
import { WsInboundMessageSchema } from '@auto-rfp/core';
import type { PresenceItem } from '@auto-rfp/core';

const WS_ENDPOINT = requireEnv('WS_API_ENDPOINT');

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const { connectionId } = event.requestContext;

  const conn = await getWsConnection(connectionId);
  if (!conn) return { statusCode: 410, body: 'Connection not found' };

  const { orgId, projectId, userId, displayName } = conn as {
    orgId: string;
    projectId: string;
    userId: string;
    displayName: string;
  };

  const raw = JSON.parse(event.body ?? '{}') as unknown;
  const { success, data: msg } = WsInboundMessageSchema.safeParse(raw);
  if (!success) return { statusCode: 400, body: 'Invalid message format' };

  const now = new Date().toISOString();

  if (msg.type === 'HEARTBEAT') {
    await upsertPresence({
      connectionId,
      projectId,
      orgId,
      userId,
      displayName: displayName ?? userId,
      questionId: msg.payload.questionId,
      status: msg.payload.status,
      connectedAt: now,
      lastHeartbeatAt: now,
    });
  }

  // Determine outbound message type
  let outboundType: string = msg.type;
  if (msg.type === 'HEARTBEAT') outboundType = 'PRESENCE_UPDATE';

  // For ANSWER_DELTA: broadcast to all connections on the same question (not just project)
  // For everything else: broadcast to all connections in the project
  await broadcastToProject(WS_ENDPOINT, orgId, projectId, connectionId, {
    type: outboundType,
    payload: { userId, displayName, ...msg.payload },
    timestamp: now,
  });

  return { statusCode: 200, body: 'OK' };
};

async function broadcastToProject(
  wsEndpoint: string,
  orgId: string,
  projectId: string,
  senderConnectionId: string,
  message: unknown,
): Promise<void> {
  const connections = await listPresence(orgId, projectId);
  const apigw = new ApiGatewayManagementApiClient({ endpoint: wsEndpoint });
  const body = JSON.stringify(message);

  const sends = connections
    .filter((c: PresenceItem) => c.connectionId !== senderConnectionId)
    .map((c: PresenceItem) =>
      apigw
        .send(
          new PostToConnectionCommand({
            ConnectionId: c.connectionId,
            Data: Buffer.from(body),
          }),
        )
        .catch(() => {
          // stale connection — ignore
        }),
    );

  await Promise.allSettled(sends);
}

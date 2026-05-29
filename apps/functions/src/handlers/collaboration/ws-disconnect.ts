import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { getWsConnection, deleteWsConnection, deletePresence } from '@/helpers/collaboration';

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const { connectionId } = event.requestContext;

  // Look up the connection record to find orgId/projectId/userId
  const conn = await getWsConnection(connectionId);

  if (conn) {
    const { orgId, projectId, userId } = conn as {
      orgId: string;
      projectId: string;
      userId: string;
    };
    await deletePresence(orgId, projectId, userId);
    await deleteWsConnection(connectionId);
  }

  return { statusCode: 200, body: 'Disconnected' };
};

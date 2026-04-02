/**
 * EventBridge listener: receives POCDeploymentComplete events from DevelopmentPlatform
 * and updates the opportunity record with the POC URL.
 *
 * Source: development-platform.poc
 * DetailType: POCDeploymentComplete
 * Detail: { oppId, orgId, projectId, pocUrl, deployedAt }
 */

import { z } from 'zod';
import { updateOpportunity } from '@/helpers/opportunity';

const POCCompleteDetailSchema = z.object({
  oppId: z.string().min(1),
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  pocUrl: z.string().url(),
  deployedAt: z.string().min(1),
});

interface EventBridgeEvent {
  detail: unknown;
  source: string;
  'detail-type': string;
}

export const handler = async (event: EventBridgeEvent): Promise<void> => {
  console.log('Received POCDeploymentComplete event', JSON.stringify(event.detail));

  const { success, data, error } = POCCompleteDetailSchema.safeParse(event.detail);
  if (!success) {
    console.error('Invalid event detail', error.issues);
    return;
  }

  const { orgId, projectId, oppId, pocUrl, deployedAt } = data;

  await updateOpportunity({
    orgId,
    projectId,
    oppId,
    patch: {
      pocUrl,
      pocDeployedAt: deployedAt,
    },
  });

  console.log(`Updated opportunity ${oppId} with pocUrl=${pocUrl}`);
};
import { getApiKey } from './api-key-storage';
import { SLACK_WEBHOOK_SECRET_PREFIX } from '@/constants/rfp-digest';

/**
 * Posts plain mrkdwn text to a Slack Incoming Webhook. The webhook URL is stored
 * per-org in Secrets Manager and is bound to a single channel by Slack itself.
 */
export const postSlackMessage = async (orgId: string, text: string): Promise<void> => {
  const webhookUrl = await getApiKey(orgId, SLACK_WEBHOOK_SECRET_PREFIX);
  if (!webhookUrl) {
    throw new Error(`No Slack webhook configured for org ${orgId}`);
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack webhook failed (${response.status}): ${body}`);
  }
};

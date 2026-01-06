import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { requireEnv } from './env';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import z from 'zod';
import { apiResponse, getOrgId } from './api';

import {
  buildSectionInputHash,
  getExecutiveBrief,
  markSectionFailed,
  markSectionInProgress,
} from './executive-opportunity-brief';

import type { ExecutiveBriefItem } from '@auto-rfp/shared';

const sqs = new SQSClient({});
const EXEC_BRIEF_QUEUE_URL = requireEnv('EXEC_BRIEF_QUEUE_URL');


export type BriefSection =
  | 'summary'
  | 'deadlines'
  | 'requirements'
  | 'contacts'
  | 'risks'
  | 'scoring';

export const ExecutiveBriefJobRequestSchema = z.object({
  executiveBriefId: z.string().min(1),
});

export type ExecutiveBriefJobRequest = z.infer<typeof ExecutiveBriefJobRequestSchema>;

export async function enqueueExecutiveBriefSection(
  event: APIGatewayProxyEventV2,
  section: BriefSection,
): Promise<APIGatewayProxyResultV2> {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(401, { ok: false, error: 'Org Id is missing' });
  const { executiveBriefId } = ExecutiveBriefJobRequestSchema.parse(JSON.parse(event.body || ''));

  try {
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);

    const inputHash = buildSectionInputHash({
      executiveBriefId,
      section,
      questionFileId: brief.questionFileId,
      textKey: brief.textKey,
    });

    await markSectionInProgress({
      executiveBriefId,
      section,
      inputHash,
    });

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: EXEC_BRIEF_QUEUE_URL,
        MessageBody: JSON.stringify({
          orgId,
          executiveBriefId,
          section,
          topK: 15,
          inputHash,
        }),
      }),
    );

    return apiResponse(202, {
      ok: true,
      executiveBriefId,
      section,
      status: 'IN_PROGRESS',
      enqueued: true,
    });
  } catch (err) {
    if (executiveBriefId) {
      try {
        await markSectionFailed({ executiveBriefId, section, error: err });
      } catch {
        // ignore
      }
    }

    console.error(`enqueue-${section} error:`, err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

export function makeEnqueueHandler(section: BriefSection) {
  return (event: APIGatewayProxyEventV2) => enqueueExecutiveBriefSection(event, section);
}
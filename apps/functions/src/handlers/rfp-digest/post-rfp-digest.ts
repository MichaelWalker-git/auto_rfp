import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '@/sentry-lambda';
import { listProjectIssues } from '@/helpers/linear';
import { postSlackMessage } from '@/helpers/slack';
import { RFP_DIGEST_PROJECT_ID } from '@/constants/rfp-digest';
import { buildDigest, formatSlackMessage } from './rfp-digest.service';

/**
 * The digest runs Monday and Thursday, so the reporting window alternates:
 * Monday covers the 4 days back to Thursday, Thursday the 3 days back to Monday.
 * Any other run day falls back to a week so a manual invoke still reads sensibly.
 */
export const resolveWindowDays = (now: Date): number => {
  const weekday = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })).getDay();
  if (weekday === 1) return 4;
  if (weekday === 4) return 3;
  return 7;
};

export const postRfpDigest = async (now: Date): Promise<{ posted: boolean; issueCount: number }> => {
  const orgId = requireEnv('RFP_DIGEST_ORG_ID');
  const projectId = process.env.RFP_DIGEST_PROJECT_ID || RFP_DIGEST_PROJECT_ID;

  const issues = await listProjectIssues(orgId, projectId);
  const digest = buildDigest(issues, now, resolveWindowDays(now));

  await postSlackMessage(orgId, formatSlackMessage(digest, now));

  console.log(`[rfp-digest] Posted digest covering ${digest.windowDays}d over ${issues.length} issues`);
  return { posted: true, issueCount: issues.length };
};

const baseHandler = async (): Promise<{ statusCode: number; body: string }> => {
  const result = await postRfpDigest(new Date());
  return { statusCode: 200, body: JSON.stringify(result) };
};

export const handler = withSentryLambda(baseHandler);

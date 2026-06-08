import { z } from 'zod';

export const MemberDetectionEventTypeSchema = z.enum(['NEW_ACCOUNT', 'ADDED_TO_ORG']);
export type MemberDetectionEventType = z.infer<typeof MemberDetectionEventTypeSchema>;

/**
 * The structured payload emitted to Sentry when a new account or
 * org-membership addition is detected. Fields map to the alert requirements:
 * timestamp, org name, email, first name, role.
 */
export const MemberDetectionEventSchema = z.object({
  eventType: MemberDetectionEventTypeSchema,
  timestamp: z.string().datetime(),
  orgId: z.string(),
  orgName: z.string(),
  email: z.string().email(),
  firstName: z.string().optional(),
  role: z.string(),
  userId: z.string(),
});
export type MemberDetectionEvent = z.infer<typeof MemberDetectionEventSchema>;

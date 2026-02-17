import { z } from 'zod';

// ─── USER_KB Access Control Entity ───

export const USER_KB_PK = 'USER_KB';

export const UserKBAccessSchema = z.object({
  userId: z.string().min(1),
  kbId: z.string().min(1),
  orgId: z.string().min(1),
  accessLevel: z.enum(['read', 'write', 'admin']).default('read'),
  grantedAt: z.string(),
  grantedBy: z.string().optional(),
});

export type UserKBAccess = z.infer<typeof UserKBAccessSchema>;

export const GrantKBAccessRequestSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  kbId: z.string().min(1, 'Knowledge Base ID is required'),
  accessLevel: z.enum(['read', 'write', 'admin']).default('read'),
});

export type GrantKBAccessRequest = z.infer<typeof GrantKBAccessRequestSchema>;

export const RevokeKBAccessRequestSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  kbId: z.string().min(1, 'Knowledge Base ID is required'),
});

export type RevokeKBAccessRequest = z.infer<typeof RevokeKBAccessRequestSchema>;

// ─── SK Helpers ───

export function buildUserKBSK(userId: string, kbId: string): string {
  return `${userId}#${kbId}`;
}

export function parseUserKBSK(sk: string): { userId: string; kbId: string } | null {
  const parts = sk.split('#');
  if (parts.length !== 2) return null;
  return { userId: parts[0], kbId: parts[1] };
}

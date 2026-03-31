import { z } from 'zod';

// ─── USER_PROJECT Access Control Entity ───
// Simple access/no-access model - permissions come from org role

export const USER_PROJECT_PK = 'USER_PROJECT';

export const UserProjectAccessSchema = z.object({
  userId: z.string().min(1),
  projectId: z.string().min(1),
  orgId: z.string().min(1),
  assignedAt: z.string(),
  assignedBy: z.string().optional(),
});

export type UserProjectAccess = z.infer<typeof UserProjectAccessSchema>;

export const AssignProjectRequestSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
});

export type AssignProjectRequest = z.infer<typeof AssignProjectRequestSchema>;

export const UnassignProjectRequestSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
});

export type UnassignProjectRequest = z.infer<typeof UnassignProjectRequestSchema>;

// ─── Bulk Grant to Admins ───

export const GrantAdminAccessRequestSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
});

export type GrantAdminAccessRequest = z.infer<typeof GrantAdminAccessRequestSchema>;

export const GrantAdminAccessResponseSchema = z.object({
  projectId: z.string(),
  grantedCount: z.number(),
  skippedCount: z.number(),
  adminUserIds: z.array(z.string()),
});

export type GrantAdminAccessResponse = z.infer<typeof GrantAdminAccessResponseSchema>;

// ─── API Response Types ───

export const ProjectAccessUsersResponseSchema = z.object({
  users: z.array(UserProjectAccessSchema),
  projectId: z.string(),
});

export type ProjectAccessUsersResponse = z.infer<typeof ProjectAccessUsersResponseSchema>;

export const UserProjectAccessResponseSchema = z.object({
  projects: z.array(UserProjectAccessSchema),
  userId: z.string(),
});

export type UserProjectAccessResponse = z.infer<typeof UserProjectAccessResponseSchema>;

// ─── SK Helpers ───

export const buildUserProjectSK = (userId: string, projectId: string): string => {
  return `${userId}#${projectId}`;
};

export const parseUserProjectSK = (sk: string): { userId: string; projectId: string } | null => {
  const parts = sk.split('#');
  if (parts.length !== 2) return null;
  return { userId: parts[0], projectId: parts[1] };
};

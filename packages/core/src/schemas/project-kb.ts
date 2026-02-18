import { z } from 'zod';

// ─── PROJECT_KB Link Entity ───

export const PROJECT_KB_PK = 'PROJECT_KB';

export const ProjectKBLinkSchema = z.object({
  projectId: z.string().min(1),
  kbId: z.string().min(1),
  orgId: z.string().min(1),
  createdAt: z.string(),
  createdBy: z.string().optional(),
});

export type ProjectKBLink = z.infer<typeof ProjectKBLinkSchema>;

export const LinkKBToProjectRequestSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  kbId: z.string().min(1, 'Knowledge Base ID is required'),
});

export type LinkKBToProjectRequest = z.infer<typeof LinkKBToProjectRequestSchema>;

export const UnlinkKBFromProjectRequestSchema = LinkKBToProjectRequestSchema;
export type UnlinkKBFromProjectRequest = z.infer<typeof UnlinkKBFromProjectRequestSchema>;

export const SetProjectKBsRequestSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  kbIds: z.array(z.string().min(1)).max(50, 'Maximum 50 knowledge bases per project'),
});

export type SetProjectKBsRequest = z.infer<typeof SetProjectKBsRequestSchema>;

// ─── SK Helpers ───

export function buildProjectKBSK(projectId: string, kbId: string): string {
  return `${projectId}#${kbId}`;
}

export function parseProjectKBSK(sk: string): { projectId: string; kbId: string } | null {
  const parts = sk.split('#');
  if (parts.length !== 2) return null;
  return { projectId: parts[0], kbId: parts[1] };
}

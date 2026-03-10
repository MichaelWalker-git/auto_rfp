import { z } from 'zod';

// ─── Project Contact Info ─────────────────────────────────────────────────────

export const ProjectContactInfoSchema = z.object({
  primaryPocName: z.string().optional(),
  primaryPocEmail: z.string().email('Invalid email address').optional().or(z.literal('')),
  primaryPocPhone: z.string().optional(),
  primaryPocTitle: z.string().optional(),
});

export type ProjectContactInfo = z.infer<typeof ProjectContactInfoSchema>;

// ─── Project Schemas ──────────────────────────────────────────────────────────

export const CreateProjectSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  contactInfo: ProjectContactInfoSchema.optional(),
});

export type CreateProjectDTO = z.infer<typeof CreateProjectSchema>;

export type ProjectItem = CreateProjectDTO & {
  id: string;
  createdAt?: string;
  updatedAt?: string;
};

export const UpdateProjectSchema = z.object({
  name: z.string().min(1, 'Project name cannot be empty').optional(),
  description: z.string().optional(),
  contactInfo: ProjectContactInfoSchema.optional(),
});

export type UpdateProjectDTO = z.infer<typeof UpdateProjectSchema>;

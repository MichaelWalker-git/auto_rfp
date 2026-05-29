import { z } from 'zod';

export const CreateProjectSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
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
});

export type UpdateProjectDTO = z.infer<typeof UpdateProjectSchema>;
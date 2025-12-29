import { z } from 'zod';

export const UpdateProjectSchema = z.object({
  name: z.string().min(1, 'Project name cannot be empty').optional(),
  description: z.string().optional(),
});

export type UpdateProjectDTO = z.infer<typeof UpdateProjectSchema>;
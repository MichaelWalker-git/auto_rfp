import { z } from 'zod';

// ─── Organization Entity ───

export const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().optional(),
  description: z.string().optional(),
  iconKey: z.string().optional(),
  bucketName: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Organization = z.infer<typeof OrganizationSchema>;

export const CreateOrganizationDTOSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters long'),
  description: z.string().max(500).optional(),
  slug: z.string().optional(),
});

export type CreateOrganizationDTO = z.infer<typeof CreateOrganizationDTOSchema>;

export const UpdateOrganizationDTOSchema = CreateOrganizationDTOSchema.partial().extend({
  iconKey: z.string().optional(),
});

export type UpdateOrganizationDTO = z.infer<typeof UpdateOrganizationDTOSchema>;

// ─── API Response Types ───

export const GetApiKeyResponseSchema = z.object({
  message: z.string(),
  apiKey: z.string(),
  orgId: z.string(),
});

export type GetApiKeyResponse = z.infer<typeof GetApiKeyResponseSchema>;

export const SetApiKeyResponseSchema = z.object({
  message: z.string(),
  orgId: z.string(),
});

export type SetApiKeyResponse = z.infer<typeof SetApiKeyResponseSchema>;

export const DeleteOrganizationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  id: z.string(),
});

export type DeleteOrganizationResponse = z.infer<typeof DeleteOrganizationResponseSchema>;

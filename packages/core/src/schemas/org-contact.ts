import { z } from 'zod';

/**
 * Organization Primary Contact schema.
 * Represents the executive who signs proposals (VP, CEO, Contracts Manager, etc.).
 * Stored as a separate entity from OrganizationItem to allow independent CRUD.
 */
export const OrgPrimaryContactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  title: z.string().trim().min(1, 'Title is required'),
  email: z.string().email('Must be a valid email'),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

export type OrgPrimaryContact = z.infer<typeof OrgPrimaryContactSchema>;

export const OrgPrimaryContactItemSchema = OrgPrimaryContactSchema.extend({
  partition_key: z.string().optional(),
  sort_key: z.string().optional(),
  orgId: z.string().min(1),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type OrgPrimaryContactItem = z.infer<typeof OrgPrimaryContactItemSchema>;

// For CRUD endpoints
export const CreateOrgPrimaryContactSchema = OrgPrimaryContactSchema;
export type CreateOrgPrimaryContactDTO = z.infer<typeof CreateOrgPrimaryContactSchema>;

export const UpdateOrgPrimaryContactSchema = OrgPrimaryContactSchema.partial();
export type UpdateOrgPrimaryContactDTO = z.infer<typeof UpdateOrgPrimaryContactSchema>;

// API response
export const OrgPrimaryContactResponseSchema = z.object({
  contact: OrgPrimaryContactItemSchema,
});
export type OrgPrimaryContactResponse = z.infer<typeof OrgPrimaryContactResponseSchema>;

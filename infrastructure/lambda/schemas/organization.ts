import { z } from 'zod';

/**
 * Zod Schema for the incoming request body (Data Transfer Object)
 * It defines the shape and validation rules for the organization data.
 */
export const CreateOrganizationSchema = z.object({
  name: z.string()
    .trim()
    .min(3, 'Name must be at least 3 characters long'),

  description: z.string()
    .trim()
    .max(500, 'Description cannot exceed 500 characters')
    .optional(), // Make description optional

  bucketName: z.string()
    .optional()
});

/**
 * Infer the TypeScript type from the schema for compile-time safety.
 * This is the exact shape of the validated request body.
 */
export type CreateOrganizationDTO = z.infer<typeof CreateOrganizationSchema>;

// --- DynamoDB Item Schema (Optional, but good practice) ---
// This represents the final item structure stored in DynamoDB, including keys and timestamps.
export const OrganizationItemSchema = CreateOrganizationSchema.extend({
  partition_key: z.string(), // Partition Key (ORG_PK)
  sort_key: z.string().startsWith('ORG#'), // Sort Key (e.g., ORG#<UUID>)
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  id: z.string(),
});

/**
 * Infer the full TypeScript type for the DynamoDB record.
 */
export type OrganizationItem = z.infer<typeof OrganizationItemSchema>;

export const UpdateOrganizationSchema = CreateOrganizationSchema.partial();

export type UpdateOrganizationDTO = z.infer<typeof UpdateOrganizationSchema>;

import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants';

/**
 * Employee — a member of the organization's delivery workforce, maintained as
 * reference data for team assembly and proposal documents (team-definition U1).
 *
 * Follows the 5-type entity pattern (see .claude/rules/03-entity-definitions.md).
 */

/** Where an employee is located (BR1.3). */
export const EmployeeLocationSchema = z.enum(['ONSHORE', 'OFFSHORE']);
export type EmployeeLocation = z.infer<typeof EmployeeLocationSchema>;

/** How the record was created (BR3.2) — manual entry or the AI CV import flow. */
export const EmployeeSourceSchema = z.enum(['MANUAL', 'AI_IMPORT']);
export type EmployeeSource = z.infer<typeof EmployeeSourceSchema>;

/** A single role entry — non-empty free text, max 100 chars (BR1.2). */
const roleEntrySchema = z
  .string()
  .trim()
  .min(1, 'Role cannot be empty')
  .max(100, 'Role cannot exceed 100 characters');

/** A single certification entry — non-empty free text, max 200 chars. */
const certificationEntrySchema = z
  .string()
  .trim()
  .min(1, 'Certification cannot be empty')
  .max(200, 'Certification cannot exceed 200 characters');

/**
 * 1. Incoming POST body (server-managed fields omitted).
 */
export const EmployeeCreateRequestSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(200, 'Name cannot exceed 200 characters'),
  primaryRoles: z.array(roleEntrySchema).default([]),
  secondaryRoles: z.array(roleEntrySchema).default([]),
  certifications: z.array(certificationEntrySchema).default([]),
  /** Org document id or an external link to a resume/bio (BR1.4). */
  resumeRef: z.string().trim().min(1).optional(),
  location: EmployeeLocationSchema.optional(),
});
export type EmployeeCreateRequest = z.infer<typeof EmployeeCreateRequestSchema>;

/**
 * 2. Incoming PATCH body — partial, identifiers not patchable (BR3.2).
 */
export const EmployeeUpdateRequestSchema = EmployeeCreateRequestSchema.partial().omit({
  orgId: true,
});
export type EmployeeUpdateRequest = z.infer<typeof EmployeeUpdateRequestSchema>;

/**
 * 3. Pure domain entity returned by the API — NO DynamoDB keys.
 */
export const EmployeeItemSchema = EmployeeCreateRequestSchema.extend({
  id: z.string(),
  source: EmployeeSourceSchema.default('MANUAL'),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  createdBy: z.string().optional(),
});
export type EmployeeItem = z.infer<typeof EmployeeItemSchema>;

/**
 * 4. DynamoDB record — domain entity plus single-table keys.
 */
export const EmployeeDBItemSchema = EmployeeItemSchema.extend({
  [PK_NAME]: z.string(),
  [SK_NAME]: z.string(),
});
export type EmployeeDBItem = z.infer<typeof EmployeeDBItemSchema>;

/**
 * 5. Lightweight projection for the employee table / list views.
 */
export const EmployeeListItemSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  primaryRoles: z.array(z.string()).default([]),
  secondaryRoles: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  location: EmployeeLocationSchema.optional(),
  source: EmployeeSourceSchema.optional(),
  updatedAt: z.string().optional(),
});
export type EmployeeListItem = z.infer<typeof EmployeeListItemSchema>;

/* ── API response shapes (for frontend hooks) ──────────── */

export const ListEmployeesResponseSchema = z.object({
  items: z.array(EmployeeItemSchema),
  count: z.number().int().nonnegative(),
});
export type ListEmployeesResponse = z.infer<typeof ListEmployeesResponseSchema>;

export const EmployeeResponseSchema = z.object({
  item: EmployeeItemSchema,
});
export type EmployeeResponse = z.infer<typeof EmployeeResponseSchema>;

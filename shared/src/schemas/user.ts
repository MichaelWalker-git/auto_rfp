import { z } from 'zod';

/**
 * Enums
 */
export const UserStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'INVITED', 'SUSPENDED']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const UserRoleSchema = z.enum([
  'OWNER',
  'ADMIN',
  'MEMBER',
  'VIEWER',
]);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * Common field helpers
 */
const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime()) // allow without offset if you sometimes store that
  .describe('ISO 8601 datetime string');

const emailSchema = z.string().email().max(254);

const phoneSchema = z
  .string()
  .min(5)
  .max(32)
  .regex(/^[+0-9()\-.\s]+$/)
  .optional();

const nonEmptyTrimmed = z
  .string()
  .trim()
  .min(1);

const idSchema = z.string().uuid();

/**
 * DynamoDB keys (adjust to your PK/SK approach)
 * - If you’re single-tenant: you can drop orgId.
 * - If multi-tenant: keep orgId and enforce it everywhere.
 */
export const UserKeySchema = z.object({
  orgId: idSchema,
  userId: idSchema,
});
export type UserKey = z.infer<typeof UserKeySchema>;

/**
 * The canonical stored entity (DB item / API response)
 */
export const UserSchema = z.object({
  orgId: idSchema,
  userId: idSchema,

  email: emailSchema,
  // display / profile
  firstName: nonEmptyTrimmed.max(100).optional(),
  lastName: nonEmptyTrimmed.max(100).optional(),
  displayName: nonEmptyTrimmed.max(200).optional(),
  phone: phoneSchema,

  // Roles (non-empty list is typical; relax if you want)
  roles: z.array(UserRoleSchema).min(1).max(50),

  status: UserStatusSchema.default('ACTIVE'),

  // Optional auth linkage (Cognito sub, etc.)
  authSubject: z.string().min(1).max(200).optional(), // e.g., cognito sub

  // Auditing
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,

  createdBy: idSchema.optional(),
  updatedBy: idSchema.optional(),
});
export type User = z.infer<typeof UserSchema>;

/**
 * Create DTO (for POST)
 * - userId typically generated server-side; omit here.
 * - createdAt/updatedAt handled server-side; omit here.
 */
export const CreateUserDTOSchema = z.object({
  orgId: idSchema,

  email: emailSchema,
  firstName: nonEmptyTrimmed.max(100).optional(),
  lastName: nonEmptyTrimmed.max(100).optional(),
  displayName: nonEmptyTrimmed.max(200).optional(),
  phone: phoneSchema,

  roles: z.array(UserRoleSchema).min(1).max(50),

  status: UserStatusSchema.optional(),
  authSubject: z.string().min(1).max(200).optional(),
});
export type CreateUserDTO = z.infer<typeof CreateUserDTOSchema>;

/**
 * Update DTO (PATCH)
 * - All fields optional; roles can be replaced fully.
 * - If you want add/remove semantics instead, see the "Role patch" DTO below.
 */
export const UpdateUserDTOSchema = z.object({
  orgId: idSchema,
  userId: idSchema,

  email: emailSchema.optional(),
  firstName: nonEmptyTrimmed.max(100).optional(),
  lastName: nonEmptyTrimmed.max(100).optional(),
  displayName: nonEmptyTrimmed.max(200).optional(),
  phone: phoneSchema.optional(),

  roles: z.array(UserRoleSchema).min(1).max(50).optional(),

  status: UserStatusSchema.optional(),
  authSubject: z.string().min(1).max(200).optional(),
});
export type UpdateUserDTO = z.infer<typeof UpdateUserDTOSchema>;

/**
 * Optional: Role patch DTO (add/remove without sending full list)
 * Use this if you prefer /users/{id}/roles endpoint.
 */
export const PatchUserRolesDTOSchema = z.object({
  orgId: idSchema,
  userId: idSchema,

  add: z.array(UserRoleSchema).max(50).optional(),
  remove: z.array(UserRoleSchema).max(50).optional(),
}).refine(
  (v) => (v.add?.length ?? 0) + (v.remove?.length ?? 0) > 0,
  { message: 'Provide at least one role to add or remove' },
);
export type PatchUserRolesDTO = z.infer<typeof PatchUserRolesDTOSchema>;

/**
 * Read/query DTOs (for Lambdas)
 */
export const GetUserQuerySchema = z.object({
  orgId: idSchema,
  userId: idSchema,
});
export type GetUserQuery = z.infer<typeof GetUserQuerySchema>;

export const ListUsersQuerySchema = z.object({
  orgId: idSchema,
  limit: z.coerce.number().int().min(1).max(200).optional(),
  nextToken: z.string().min(1).optional(), // e.g. base64(JSON(ExclusiveStartKey))
  status: UserStatusSchema.optional(),
  role: UserRoleSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(), // email/name search (if you support it)
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

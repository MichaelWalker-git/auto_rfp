import { z } from 'zod';

/**
 * Enums
 */
export const UserStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'INVITED', 'SUSPENDED']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const UserRoleSchema = z.enum([
  'EDITOR',
  'ADMIN',
  'BILLING',
  'VIEWER',
  'MEMBER'
]);

export const EditUserRoleRequestSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1),
  role: UserRoleSchema
});

export type EditUserRoleRequest = z.infer<typeof EditUserRoleRequestSchema>;

export type UserRole = z.infer<typeof UserRoleSchema>;

export const USER_PERMISSIONS = [
  'user:create', 'user:edit', 'user:delete', 'user:read',
] as const;

export const ORG_PERMISSIONS = [
  'org:create', 'org:edit', 'org:delete', 'org:read', 'org:manage_users', 'org:manage_settings',
] as const;

export const PROPOSAL_PERMISSIONS = [
  'proposal:read', 'proposal:create', 'proposal:edit', 'proposal:delete', 'proposal:export',
] as const;

export const ALL_PERMISSIONS = [
  ...USER_PERMISSIONS,
  ...ORG_PERMISSIONS,
  ...PROPOSAL_PERMISSIONS,
  'kb:upload', 'kb:read', 'kb:create', 'kb:edit', 'kb:delete',
  'project:create', 'project:edit', 'project:read', 'project:delete',
  'question:read', 'question:create', 'question:edit', 'question:delete',
  'document:create', 'document:edit', 'document:read', 'document:delete',
  'answer:create', 'answer:read', 'answer:generate', 'answer:edit',
  'brief:create', 'brief:edit',
  'index:retry'
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  ADMIN: [
    'org:read', 'org:manage_users', 'org:manage_settings',
    'proposal:read', 'proposal:create', 'proposal:edit', 'proposal:delete', 'proposal:export',
    'kb:read', 'kb:upload', 'kb:create', 'kb:delete', 'kb:edit',
    'project:create', 'project:delete',
    'user:create', 'user:edit', 'user:delete', 'user:read',
    'answer:create', 'answer:read', 'answer:generate', 'answer:edit',
    'brief:create', 'brief:edit',
    'index:retry'
  ],
  EDITOR: [
    'org:read',
    'proposal:read', 'proposal:create', 'proposal:edit', 'proposal:export',
    'kb:read', 'kb:upload',
    'user:create'
  ],
  VIEWER: [
    'question:read', 'org:read', 'kb:read', 'proposal:read', 'project:read', 'document:read', 'user:read',
  ],
  BILLING: [
    'question:read', 'org:read', 'kb:read', 'proposal:read', 'project:read',
  ],
  MEMBER: []
};

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
  role: UserRoleSchema.default('VIEWER'),
  status: UserStatusSchema.optional(),
  authSubject: z.string().min(1).max(200).optional(),
});
export type CreateUserDTO = z.infer<typeof CreateUserDTOSchema>;

export const UpdateUserDTOSchema = z.object({
  orgId: idSchema,
  userId: idSchema,

  email: emailSchema.optional(),
  firstName: nonEmptyTrimmed.max(100).optional(),
  lastName: nonEmptyTrimmed.max(100).optional(),
  displayName: nonEmptyTrimmed.max(200).optional(),
  phone: phoneSchema.optional(),

  role: UserRoleSchema.optional(),

  status: UserStatusSchema.optional(),
  authSubject: z.string().min(1).max(200).optional(),
});
export type UpdateUserDTO = z.infer<typeof UpdateUserDTOSchema>;

/**
 * Optional: Role patch DTO (add/remove without sending full list)
 * Use this if you prefer /users/{id}/roles endpoint.
 */
export const PatchUserRoleDTOSchema = z.object({
  orgId: idSchema,
  userId: idSchema,
  role: UserRoleSchema.default('VIEWER'),
});
export type PatchUserRoleDTO = z.infer<typeof PatchUserRoleDTOSchema>;

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

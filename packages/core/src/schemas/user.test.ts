import { describe, it, expect } from 'vitest';
import {
  UserStatusSchema,
  UserRoleSchema,
  UserSchema,
  CreateUserDTOSchema,
  UpdateUserDTOSchema,
  GetUserQuerySchema,
  ListUsersQuerySchema,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  VIEWER_PERMISSIONS,
} from './user';

describe('UserStatusSchema', () => {
  it('should accept valid statuses', () => {
    expect(UserStatusSchema.parse('ACTIVE')).toBe('ACTIVE');
    expect(UserStatusSchema.parse('INACTIVE')).toBe('INACTIVE');
    expect(UserStatusSchema.parse('INVITED')).toBe('INVITED');
    expect(UserStatusSchema.parse('SUSPENDED')).toBe('SUSPENDED');
  });

  it('should reject invalid statuses', () => {
    expect(() => UserStatusSchema.parse('INVALID')).toThrow();
    expect(() => UserStatusSchema.parse('')).toThrow();
    expect(() => UserStatusSchema.parse(null)).toThrow();
  });
});

describe('UserRoleSchema', () => {
  it('should accept valid roles', () => {
    expect(UserRoleSchema.parse('ADMIN')).toBe('ADMIN');
    expect(UserRoleSchema.parse('EDITOR')).toBe('EDITOR');
    expect(UserRoleSchema.parse('VIEWER')).toBe('VIEWER');
    expect(UserRoleSchema.parse('BILLING')).toBe('BILLING');
    expect(UserRoleSchema.parse('MEMBER')).toBe('MEMBER');
  });

  it('should reject invalid roles', () => {
    expect(() => UserRoleSchema.parse('SUPERADMIN')).toThrow();
    expect(() => UserRoleSchema.parse('')).toThrow();
  });
});

describe('UserSchema', () => {
  const validUser = {
    orgId: '550e8400-e29b-41d4-a716-446655440000',
    userId: '550e8400-e29b-41d4-a716-446655440001',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    roles: ['ADMIN'],
    status: 'ACTIVE',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  it('should accept a valid user', () => {
    const result = UserSchema.parse(validUser);
    expect(result.email).toBe('test@example.com');
    expect(result.roles).toEqual(['ADMIN']);
  });

  it('should require valid UUID for orgId', () => {
    expect(() => UserSchema.parse({ ...validUser, orgId: 'invalid' })).toThrow();
  });

  it('should require valid email', () => {
    expect(() => UserSchema.parse({ ...validUser, email: 'invalid' })).toThrow();
    expect(() => UserSchema.parse({ ...validUser, email: '' })).toThrow();
  });

  it('should require at least one role', () => {
    expect(() => UserSchema.parse({ ...validUser, roles: [] })).toThrow();
  });

  it('should accept multiple roles', () => {
    const result = UserSchema.parse({ ...validUser, roles: ['ADMIN', 'EDITOR'] });
    expect(result.roles).toHaveLength(2);
  });

  it('should default status to ACTIVE', () => {
    const userWithoutStatus = { ...validUser };
    delete (userWithoutStatus as Record<string, unknown>).status;
    const result = UserSchema.parse(userWithoutStatus);
    expect(result.status).toBe('ACTIVE');
  });

  it('should accept optional fields', () => {
    const minimalUser = {
      orgId: validUser.orgId,
      userId: validUser.userId,
      email: validUser.email,
      roles: validUser.roles,
      createdAt: validUser.createdAt,
      updatedAt: validUser.updatedAt,
    };
    const result = UserSchema.parse(minimalUser);
    expect(result.firstName).toBeUndefined();
    expect(result.lastName).toBeUndefined();
  });

  it('should validate phone format', () => {
    const userWithPhone = { ...validUser, phone: '+1-555-123-4567' };
    const result = UserSchema.parse(userWithPhone);
    expect(result.phone).toBe('+1-555-123-4567');

    expect(() => UserSchema.parse({ ...validUser, phone: 'abc' })).toThrow();
  });

  it('should require valid ISO datetime for createdAt', () => {
    expect(() => UserSchema.parse({ ...validUser, createdAt: 'invalid' })).toThrow();
  });
});

describe('CreateUserDTOSchema', () => {
  it('should accept valid create DTO', () => {
    const dto = {
      orgId: '550e8400-e29b-41d4-a716-446655440000',
      email: 'new@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
    };
    const result = CreateUserDTOSchema.parse(dto);
    expect(result.email).toBe('new@example.com');
    expect(result.role).toBe('VIEWER'); // default
  });

  it('should allow specifying role', () => {
    const dto = {
      orgId: '550e8400-e29b-41d4-a716-446655440000',
      email: 'admin@example.com',
      role: 'ADMIN',
    };
    const result = CreateUserDTOSchema.parse(dto);
    expect(result.role).toBe('ADMIN');
  });

  it('should require orgId and email', () => {
    expect(() => CreateUserDTOSchema.parse({ email: 'test@example.com' })).toThrow();
    expect(() => CreateUserDTOSchema.parse({ orgId: '550e8400-e29b-41d4-a716-446655440000' })).toThrow();
  });
});

describe('UpdateUserDTOSchema', () => {
  it('should accept partial updates', () => {
    const dto = {
      orgId: '550e8400-e29b-41d4-a716-446655440000',
      userId: '550e8400-e29b-41d4-a716-446655440001',
      firstName: 'Updated',
    };
    const result = UpdateUserDTOSchema.parse(dto);
    expect(result.firstName).toBe('Updated');
    expect(result.email).toBeUndefined();
  });

  it('should require orgId and userId', () => {
    expect(() => UpdateUserDTOSchema.parse({ firstName: 'Test' })).toThrow();
  });
});

describe('GetUserQuerySchema', () => {
  it('should require both orgId and userId', () => {
    const query = {
      orgId: '550e8400-e29b-41d4-a716-446655440000',
      userId: '550e8400-e29b-41d4-a716-446655440001',
    };
    const result = GetUserQuerySchema.parse(query);
    expect(result.orgId).toBeDefined();
    expect(result.userId).toBeDefined();
  });

  it('should reject invalid UUIDs', () => {
    expect(() => GetUserQuerySchema.parse({ orgId: 'invalid', userId: 'invalid' })).toThrow();
  });
});

describe('ListUsersQuerySchema', () => {
  it('should accept minimal query', () => {
    const query = { orgId: '550e8400-e29b-41d4-a716-446655440000' };
    const result = ListUsersQuerySchema.parse(query);
    expect(result.orgId).toBeDefined();
  });

  it('should accept optional filters', () => {
    const query = {
      orgId: '550e8400-e29b-41d4-a716-446655440000',
      limit: 50,
      status: 'ACTIVE',
      role: 'ADMIN',
      search: 'john',
    };
    const result = ListUsersQuerySchema.parse(query);
    expect(result.limit).toBe(50);
    expect(result.status).toBe('ACTIVE');
  });

  it('should coerce limit to number', () => {
    const query = {
      orgId: '550e8400-e29b-41d4-a716-446655440000',
      limit: '25',
    };
    const result = ListUsersQuerySchema.parse(query);
    expect(result.limit).toBe(25);
  });

  it('should enforce limit bounds', () => {
    const query = { orgId: '550e8400-e29b-41d4-a716-446655440000' };
    expect(() => ListUsersQuerySchema.parse({ ...query, limit: 0 })).toThrow();
    expect(() => ListUsersQuerySchema.parse({ ...query, limit: 500 })).toThrow();
  });
});

describe('ROLE_PERMISSIONS', () => {
  it('should give ADMIN all permissions', () => {
    expect(ROLE_PERMISSIONS.ADMIN).toEqual(expect.arrayContaining([...ALL_PERMISSIONS]));
    expect(ROLE_PERMISSIONS.ADMIN.length).toBe(ALL_PERMISSIONS.length);
  });

  it('should give VIEWER only read permissions', () => {
    expect(ROLE_PERMISSIONS.VIEWER).toEqual(expect.arrayContaining([...VIEWER_PERMISSIONS]));
    ROLE_PERMISSIONS.VIEWER.forEach((perm) => {
      // collaboration permissions use non-:read suffixes but are still viewer-safe
      const isCollaborationPerm = perm.startsWith('collaboration:');
      if (!isCollaborationPerm) {
        expect(perm).toMatch(/:read$/);
      }
    });
  });

  it('should give EDITOR read and write permissions', () => {
    expect(ROLE_PERMISSIONS.EDITOR.length).toBeGreaterThan(ROLE_PERMISSIONS.VIEWER.length);
    expect(ROLE_PERMISSIONS.EDITOR).toContain('question:create');
    expect(ROLE_PERMISSIONS.EDITOR).toContain('question:edit');
  });

  it('should give MEMBER no permissions', () => {
    expect(ROLE_PERMISSIONS.MEMBER).toHaveLength(0);
  });

  it('should give BILLING limited read permissions', () => {
    expect(ROLE_PERMISSIONS.BILLING).toContain('org:read');
    expect(ROLE_PERMISSIONS.BILLING).not.toContain('user:create');
  });
});

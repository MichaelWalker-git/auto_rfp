import { describe, it, expect } from 'vitest';
import {
  ProjectCreateRequestSchema,
  ProjectUpdateRequestSchema,
  type ProjectCreateRequest,
  type ProjectItem,
} from './project';

describe('ProjectCreateRequestSchema', () => {
  it('should accept valid project data', () => {
    const data: ProjectCreateRequest = {
      orgId: 'org-123',
      name: 'Test Project',
      description: 'A test project description',
    };
    const result = ProjectCreateRequestSchema.parse(data);
    expect(result.name).toBe('Test Project');
    expect(result.description).toBe('A test project description');
  });

  it('should require orgId', () => {
    expect(() =>
      ProjectCreateRequestSchema.parse({
        name: 'Test Project',
      })
    ).toThrow();
  });

  it('should require name', () => {
    expect(() =>
      ProjectCreateRequestSchema.parse({
        orgId: 'org-123',
      })
    ).toThrow();
  });

  it('should reject empty name', () => {
    expect(() =>
      ProjectCreateRequestSchema.parse({
        orgId: 'org-123',
        name: '',
      })
    ).toThrow(/Project name is required/);
  });

  it('should reject empty orgId', () => {
    expect(() =>
      ProjectCreateRequestSchema.parse({
        orgId: '',
        name: 'Test',
      })
    ).toThrow(/Organization ID is required/);
  });

  it('should allow missing description', () => {
    const data = {
      orgId: 'org-123',
      name: 'Test Project',
    };
    const result = ProjectCreateRequestSchema.parse(data);
    expect(result.description).toBeUndefined();
  });

  it('should allow empty description', () => {
    const data = {
      orgId: 'org-123',
      name: 'Test Project',
      description: '',
    };
    const result = ProjectCreateRequestSchema.parse(data);
    expect(result.description).toBe('');
  });
});

describe('ProjectUpdateRequestSchema', () => {
  it('should accept partial updates with name only', () => {
    const data = {
      name: 'Updated Name',
    };
    const result = ProjectUpdateRequestSchema.parse(data);
    expect(result.name).toBe('Updated Name');
    expect(result.description).toBeUndefined();
  });

  it('should accept partial updates with description only', () => {
    const data = {
      description: 'Updated description',
    };
    const result = ProjectUpdateRequestSchema.parse(data);
    expect(result.description).toBe('Updated description');
    expect(result.name).toBeUndefined();
  });

  it('should accept full updates', () => {
    const data = {
      name: 'Updated Name',
      description: 'Updated description',
    };
    const result = ProjectUpdateRequestSchema.parse(data);
    expect(result.name).toBe('Updated Name');
    expect(result.description).toBe('Updated description');
  });

  it('should accept empty object (no updates)', () => {
    const result = ProjectUpdateRequestSchema.parse({});
    expect(result.name).toBeUndefined();
    expect(result.description).toBeUndefined();
  });

  it('should reject empty name when provided', () => {
    expect(() =>
      ProjectUpdateRequestSchema.parse({
        name: '',
      })
    ).toThrow(/Project name cannot be empty/);
  });

  it('should allow empty description when provided', () => {
    const result = ProjectUpdateRequestSchema.parse({
      description: '',
    });
    expect(result.description).toBe('');
  });
});

describe('ProjectItem type', () => {
  it('should extend ProjectCreateRequest with id', () => {
    const project: ProjectItem = {
      id: 'proj-123',
      orgId: 'org-123',
      name: 'Test Project',
      description: 'Description',
    };
    expect(project.id).toBe('proj-123');
    expect(project.orgId).toBe('org-123');
    expect(project.name).toBe('Test Project');
  });
});

import { describe, it, expect } from 'vitest';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  type CreateProjectDTO,
  type ProjectItem,
} from './project';

describe('CreateProjectSchema', () => {
  it('should accept valid project data', () => {
    const data: CreateProjectDTO = {
      orgId: 'org-123',
      name: 'Test Project',
      description: 'A test project description',
    };
    const result = CreateProjectSchema.parse(data);
    expect(result.name).toBe('Test Project');
    expect(result.description).toBe('A test project description');
  });

  it('should require orgId', () => {
    expect(() =>
      CreateProjectSchema.parse({
        name: 'Test Project',
      })
    ).toThrow();
  });

  it('should require name', () => {
    expect(() =>
      CreateProjectSchema.parse({
        orgId: 'org-123',
      })
    ).toThrow();
  });

  it('should reject empty name', () => {
    expect(() =>
      CreateProjectSchema.parse({
        orgId: 'org-123',
        name: '',
      })
    ).toThrow(/Project name is required/);
  });

  it('should reject empty orgId', () => {
    expect(() =>
      CreateProjectSchema.parse({
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
    const result = CreateProjectSchema.parse(data);
    expect(result.description).toBeUndefined();
  });

  it('should allow empty description', () => {
    const data = {
      orgId: 'org-123',
      name: 'Test Project',
      description: '',
    };
    const result = CreateProjectSchema.parse(data);
    expect(result.description).toBe('');
  });
});

describe('UpdateProjectSchema', () => {
  it('should accept partial updates with name only', () => {
    const data = {
      name: 'Updated Name',
    };
    const result = UpdateProjectSchema.parse(data);
    expect(result.name).toBe('Updated Name');
    expect(result.description).toBeUndefined();
  });

  it('should accept partial updates with description only', () => {
    const data = {
      description: 'Updated description',
    };
    const result = UpdateProjectSchema.parse(data);
    expect(result.description).toBe('Updated description');
    expect(result.name).toBeUndefined();
  });

  it('should accept full updates', () => {
    const data = {
      name: 'Updated Name',
      description: 'Updated description',
    };
    const result = UpdateProjectSchema.parse(data);
    expect(result.name).toBe('Updated Name');
    expect(result.description).toBe('Updated description');
  });

  it('should accept empty object (no updates)', () => {
    const result = UpdateProjectSchema.parse({});
    expect(result.name).toBeUndefined();
    expect(result.description).toBeUndefined();
  });

  it('should reject empty name when provided', () => {
    expect(() =>
      UpdateProjectSchema.parse({
        name: '',
      })
    ).toThrow(/Project name cannot be empty/);
  });

  it('should allow empty description when provided', () => {
    const result = UpdateProjectSchema.parse({
      description: '',
    });
    expect(result.description).toBe('');
  });
});

describe('ProjectItem type', () => {
  it('should extend CreateProjectDTO with id', () => {
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

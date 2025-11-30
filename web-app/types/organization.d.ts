import { Project } from './project';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  projects?: Project[];
  organizationUsers?: OrganizationUser[];
}

export interface OrganizationUser {
  id: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
  updatedAt: string;
  userId: string;
  organizationId: string;
  user?: User;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
} 
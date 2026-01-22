export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  progress?: number;
  status?: string;
  orgId?: string;
} 
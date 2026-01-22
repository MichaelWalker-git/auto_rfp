import { UserRole } from '@auto-rfp/shared';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  joinedAt: string;
  avatarUrl?: string;
} 
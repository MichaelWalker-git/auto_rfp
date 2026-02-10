import { UserRole } from '@auto-rfp/shared';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  phone?: string;
  role: UserRole | string;
  status?: string;
  joinedAt: string;
  avatarUrl?: string;
}

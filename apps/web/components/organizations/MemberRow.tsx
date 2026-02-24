'use client';

import React from 'react';
import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ChevronRight } from 'lucide-react';
import type { TeamMember } from './types';
import type { UserRole } from '@auto-rfp/core';
import { formatDate } from '@/components/brief/helpers';
import { useAuth } from '@/components/AuthProvider';

interface MemberRowProps {
  member: TeamMember;
  orgId: string;
  onMemberUpdated: (updatedMember: TeamMember) => void;
  onMemberRemoved: (memberId: string) => void;
}

const ROLE_BADGE_MAP: Record<string, { variant: 'default' | 'secondary' | 'outline'; label: string }> = {
  ADMIN: { variant: 'default', label: 'Admin' },
  BILLING: { variant: 'default', label: 'Owner' },
  EDITOR: { variant: 'secondary', label: 'Editor' },
  VIEWER: { variant: 'outline', label: 'Viewer' },
  MEMBER: { variant: 'outline', label: 'Member' },
};

const STATUS_BADGE_MAP: Record<string, { variant: 'default' | 'secondary' | 'outline' | 'destructive'; label: string }> = {
  ACTIVE: { variant: 'default', label: 'Active' },
  INACTIVE: { variant: 'outline', label: 'Inactive' },
  INVITED: { variant: 'secondary', label: 'Invited' },
  SUSPENDED: { variant: 'destructive', label: 'Suspended' },
};

export function MemberRow({ member, orgId }: MemberRowProps) {
  const { userSub } = useAuth();
  const isCurrentUser = member.id === userSub;
  const joinedLabel = formatDate(member.joinedAt);
  const roleConfig = ROLE_BADGE_MAP[member.role] ?? ROLE_BADGE_MAP.MEMBER;
  const statusConfig = STATUS_BADGE_MAP[member.status ?? 'ACTIVE'] ?? STATUS_BADGE_MAP.ACTIVE;
  const initials = (member.name ?? '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const viewHref = `/organizations/${orgId}/team/${member.id}`;

  return (
    <Link href={viewHref} className="block group">
      <div className="flex items-center gap-4 rounded-xl border bg-card p-4 transition-all hover:bg-muted/40 hover:shadow-sm">
        {/* Avatar */}
        <Avatar className="h-10 w-10 shrink-0">
          {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt={member.name} />}
          <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>

        {/* Identity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium leading-none">
              {member.name}
            </span>
            {isCurrentUser && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                You
              </Badge>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{member.email}</span>
            <span className="hidden sm:inline text-muted-foreground/40">•</span>
            <span className="hidden sm:inline whitespace-nowrap">Joined {joinedLabel}</span>
          </div>
        </div>

        {/* Badges */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          <Badge variant={roleConfig.variant}>{roleConfig.label}</Badge>
          {member.status && member.status !== 'ACTIVE' && (
            <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
          )}
        </div>

        {/* Mobile badges */}
        <div className="sm:hidden shrink-0">
          <Badge variant={roleConfig.variant} className="text-[10px]">
            {roleConfig.label}
          </Badge>
        </div>

        {/* Chevron indicator */}
        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
      </div>
    </Link>
  );
}

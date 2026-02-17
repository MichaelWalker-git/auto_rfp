'use client';

import React from 'react';
import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Pencil } from 'lucide-react';
import PermissionWrapper from '@/components/permission-wrapper';
import type { TeamMember } from './types';
import type { UserRole } from '@auto-rfp/shared';
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

export function MemberRow({ member, orgId }: MemberRowProps) {
  const { userSub } = useAuth();
  const isCurrentUser = member.id === userSub;
  const joinedLabel = formatDate(member.joinedAt);
  const roleConfig = ROLE_BADGE_MAP[member.role] ?? ROLE_BADGE_MAP.MEMBER;

  return (
    <Card className="group transition-colors hover:bg-muted/40">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        {/* Left: identity */}
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="h-9 w-9">
            {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt={member.name} />}
            <AvatarFallback className="text-xs">
              {(member.name?.[0] ?? '?').toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium leading-none">{member.name}</span>
              <span className="hidden sm:block">
                <Badge variant={roleConfig.variant}>{roleConfig.label}</Badge>
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{member.email}</span>
              <span className="hidden sm:inline">•</span>
              <span className="hidden sm:inline">Joined {joinedLabel}</span>
            </div>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-3">
          <div className="sm:hidden">
            <Badge variant={roleConfig.variant}>{roleConfig.label}</Badge>
          </div>
          {isCurrentUser ? (
            <Badge variant="outline" className="text-xs text-muted-foreground">You</Badge>
          ) : (
            <PermissionWrapper requiredPermission="user:edit">
              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity" asChild>
                <Link href={`/organizations/${orgId}/team/${member.id}`}>
                  <Pencil className="h-4 w-4" />
                </Link>
              </Button>
            </PermissionWrapper>
          )}
        </div>
      </div>
    </Card>
  );
}

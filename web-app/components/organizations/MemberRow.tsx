'use client';

import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import PermissionWrapper from '@/components/permission-wrapper';
import { MemberActionsDropdown } from './MemberActionsDropdown';
import { TeamMember } from './types';
import { UserRole } from '@auto-rfp/shared';
import { formatDate } from '@/components/brief/helpers';

interface MemberRowProps {
  member: TeamMember;
  orgId: string;
  onMemberUpdated: (updatedMember: TeamMember) => void;
  onMemberRemoved: (memberId: string) => void;
}

export function MemberRow({
  member,
  orgId,
  onMemberUpdated,
  onMemberRemoved,
}: MemberRowProps) {
  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'EDITOR':
        return <Badge variant="secondary">Editor</Badge>;
      case 'ADMIN':
        return <Badge variant="default">Admin</Badge>;
      case 'BILLING':
        return <Badge variant="default">Owner</Badge>;
      case 'VIEWER':
        return <Badge variant="outline">Viewer</Badge>;
      default:
        return <Badge variant="outline">Member</Badge>;
    }
  };

  const joinedLabel = formatDate(member.joinedAt);

  return (
    <Card className="group">
      <div className="flex items-center justify-between gap-2 px-4 transition-colors hover:bg-muted/40">
        {/* Left: identity */}
        <div className="flex min-w-0 items-center gap-1">
          <Avatar className="h-9 w-9">
            {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt={member.name} /> : null}
            <AvatarFallback className="text-xs">
              {(member.name?.[0] ?? '?').toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate font-medium leading-none">{member.name}</div>
              <div className="hidden sm:block">{getRoleBadge(member.role as UserRole)}</div>
            </div>

            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{member.email}</span>
              <span className="hidden sm:inline">•</span>
              <span className="hidden sm:inline">Joined {joinedLabel}</span>
            </div>
          </div>
        </div>

        {/* Right: meta + actions */}
        <div className="flex items-center gap-3">
          <div className="sm:hidden">{getRoleBadge(member.role as UserRole)}</div>
          <PermissionWrapper requiredPermission={'user:edit'}>
            <div className="opacity-100 md:opacity-100">
              <MemberActionsDropdown
                member={member}
                orgId={orgId}
                onMemberUpdated={onMemberUpdated}
                onMemberRemoved={onMemberRemoved}
              />
            </div>
          </PermissionWrapper>
        </div>
      </div>
    </Card>
  );
}
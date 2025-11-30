'use client';

import React from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { MemberActionsDropdown } from "./MemberActionsDropdown";
import { TeamMember } from "./types";

interface MemberTableRowProps {
  member: TeamMember;
  orgId: string;
  onMemberUpdated: (updatedMember: TeamMember) => void;
  onMemberRemoved: (memberId: string) => void;
}

export function MemberTableRow({ 
  member, 
  orgId, 
  onMemberUpdated, 
  onMemberRemoved 
}: MemberTableRowProps) {
  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'owner':
        return <Badge variant="default">Owner</Badge>;
      case 'admin':
        return <Badge variant="secondary">Admin</Badge>;
      default:
        return <Badge variant="outline">Member</Badge>;
    }
  };

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            {member.avatarUrl ? (
              <AvatarImage src={member.avatarUrl} alt={member.name} />
            ) : null}
            <AvatarFallback>
              {member.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">{member.name}</div>
            <div className="text-xs text-muted-foreground">{member.email}</div>
          </div>
        </div>
      </TableCell>
      <TableCell>{getRoleBadge(member.role)}</TableCell>
      <TableCell>{new Date(member.joinedAt).toLocaleDateString()}</TableCell>
      <TableCell className="text-right">
        <MemberActionsDropdown 
          member={member}
          orgId={orgId}
          onMemberUpdated={onMemberUpdated}
          onMemberRemoved={onMemberRemoved}
        />
      </TableCell>
    </TableRow>
  );
} 
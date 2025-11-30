'use client';

import React from "react";
import { 
  Table, 
  TableBody, 
  TableCaption, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { MemberTableRow } from "./MemberTableRow";
import { TeamMember } from "./types";

interface TeamMembersTableProps {
  members: TeamMember[];
  orgId: string;
  organizationName?: string;
  isLoading: boolean;
  onMemberUpdated: (updatedMember: TeamMember) => void;
  onMemberRemoved: (memberId: string) => void;
}

export function TeamMembersTable({ 
  members, 
  orgId, 
  organizationName, 
  isLoading, 
  onMemberUpdated, 
  onMemberRemoved 
}: TeamMembersTableProps) {
  return (
    <div className="border rounded-md overflow-hidden">
      <Table>
        <TableCaption>
          List of team members in {organizationName || 'this organization'}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-8">
                <div className="flex justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
                <div className="mt-2 text-muted-foreground">Loading team members...</div>
              </TableCell>
            </TableRow>
          ) : members.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-8">
                <div className="text-muted-foreground">No team members found</div>
              </TableCell>
            </TableRow>
          ) : (
            members.map((member) => (
              <MemberTableRow
                key={member.id}
                member={member}
                orgId={orgId}
                onMemberUpdated={onMemberUpdated}
                onMemberRemoved={onMemberRemoved}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
} 
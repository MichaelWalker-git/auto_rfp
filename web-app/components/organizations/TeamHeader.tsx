'use client';

import React from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { InviteMemberDialog } from "./InviteMemberDialog";
import { TeamMember } from "./types";

interface TeamHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  orgId: string;
  onMemberAdded: (member: TeamMember) => void;
}

export function TeamHeader({ 
  searchQuery, 
  onSearchChange, 
  orgId, 
  onMemberAdded 
}: TeamHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row justify-between gap-4">
      <h1 className="text-2xl font-semibold">Team</h1>
      <div className="flex gap-2">
        <div className="relative flex-1 md:w-64">
          <Input
            type="text"
            placeholder="Search team members"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9"
          />
          <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        </div>
        <InviteMemberDialog 
          orgId={orgId}
          onMemberAdded={onMemberAdded}
        />
      </div>
    </div>
  );
} 
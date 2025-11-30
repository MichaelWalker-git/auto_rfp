'use client';

import React from "react";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, TrashIcon } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TeamMember } from "./types";

interface MemberActionsDropdownProps {
  member: TeamMember;
  orgId: string;
  onMemberUpdated: (updatedMember: TeamMember) => void;
  onMemberRemoved: (memberId: string) => void;
}

export function MemberActionsDropdown({ 
  member, 
  orgId, 
  onMemberUpdated, 
  onMemberRemoved 
}: MemberActionsDropdownProps) {
  const { toast } = useToast();

  const handleRemoveMember = async () => {
    try {
      const response = await fetch(`/api/organizations/${orgId}/members/${member.id}`, {
        method: "DELETE",
      });
      
      if (!response.ok) {
        throw new Error("Failed to remove member");
      }
      
      onMemberRemoved(member.id);
      
      toast({
        title: "Success",
        description: "Team member removed",
      });
    } catch (error) {
      console.error("Error removing member:", error);
      toast({
        title: "Error",
        description: "Failed to remove team member",
        variant: "destructive",
      });
    }
  };

  const updateMemberRole = async (newRole: 'owner' | 'admin' | 'member') => {
    try {
      const response = await fetch(`/api/organizations/${orgId}/members/${member.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: newRole }),
      });
      
      if (!response.ok) {
        throw new Error("Failed to update member role");
      }
      
      onMemberUpdated({ ...member, role: newRole });
      
      toast({
        title: "Success",
        description: "Member role updated",
      });
    } catch (error) {
      console.error("Error updating member role:", error);
      toast({
        title: "Error",
        description: "Failed to update member role",
        variant: "destructive",
      });
    }
  };

  // Don't show actions for owners
  if (member.role === 'owner') {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          onClick={() => updateMemberRole('admin')}
          disabled={member.role === 'admin'}
        >
          Make Admin
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => updateMemberRole('member')}
          disabled={member.role === 'member'}
        >
          Make Member
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          className="text-destructive focus:text-destructive"
          onClick={handleRemoveMember}
        >
          <TrashIcon className="h-4 w-4 mr-2" />
          Remove from team
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 
'use client';

import React, { useState, useEffect } from "react";
import { useOrganization, useOrganizationMembers } from "@/lib/hooks/use-api";
import { useToast } from "@/components/ui/use-toast";
import { TeamHeader } from "./TeamHeader";
import { TeamMembersTable } from "./TeamMembersTable";
import { TeamMember } from "./types";

interface TeamContentProps {
  orgId: string;
}

export function TeamContent({ orgId }: TeamContentProps) {

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [organization, setOrganization] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const { data: orgData, isLoading: isOrgLoading, isError: isOrgError } = useOrganization(orgId);
  const { data: membersData, isLoading: isMembersLoading, isError: isMembersError } = useOrganizationMembers(orgId);
  
  useEffect(() => {
    if (orgData) {
      setOrganization(orgData);
    }
    
    if (membersData && Array.isArray(membersData)) {
      
      
      // Transform the data structure to match our TeamMember interface
      const transformedMembers = membersData.map((orgUser: any) => ({
        id: orgUser.userId,
        name: orgUser.user?.name || 'Unknown',
        email: orgUser.user?.email || '',
        role: orgUser.role,
        joinedAt: orgUser.createdAt,
        avatarUrl: orgUser.user?.avatarUrl
      }));
      
      setMembers(transformedMembers);
    }
    
    // Set loading state based on both data sources
    setIsLoading(isOrgLoading || isMembersLoading);
    
    // Handle errors
    if (isOrgError || isMembersError) {
      toast({
        title: "Error",
        description: "Failed to load team data",
        variant: "destructive",
      });
    }
  }, [orgData, membersData, isOrgLoading, isMembersLoading, isOrgError, isMembersError, toast]);

  // Filter members based on search
  const filteredMembers = members.filter(member => 
    (member.name?.toLowerCase().includes(searchQuery.toLowerCase()) || false) ||
    (member.email?.toLowerCase().includes(searchQuery.toLowerCase()) || false)
  );

  const handleMemberAdded = (newMember: TeamMember) => {
    setMembers([...members, newMember]);
  };

  const handleMemberUpdated = (updatedMember: TeamMember) => {
    setMembers(members.map(m => 
      m.id === updatedMember.id ? updatedMember : m
    ));
  };

  const handleMemberRemoved = (memberId: string) => {
    setMembers(members.filter(m => m.id !== memberId));
  };

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="py-6 px-4 sm:px-6">
        <div className="flex flex-col gap-6">
          <TeamHeader 
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            orgId={orgId}
            onMemberAdded={handleMemberAdded}
          />
          
          <TeamMembersTable 
            members={filteredMembers}
            orgId={orgId}
            organizationName={organization?.name}
            isLoading={isLoading}
            onMemberUpdated={handleMemberUpdated}
            onMemberRemoved={handleMemberRemoved}
          />
        </div>
      </div>
    </div>
  );
} 
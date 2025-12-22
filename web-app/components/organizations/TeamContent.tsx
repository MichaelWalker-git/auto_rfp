'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { TeamHeader } from './TeamHeader';
import { TeamMembersTable } from './TeamMembersTable';
import type { TeamMember } from './types';

import { useOrganization } from '@/lib/hooks/use-api';
import { UserListItem, useUsersList } from '@/lib/hooks/use-user';

interface TeamContentProps {
  orgId: string;
}

function toTeamMember(u: UserListItem): TeamMember {
  const name =
    u.displayName ||
    [u.firstName, u.lastName].filter(Boolean).join(' ') ||
    u.email ||
    'Unknown';

  return {
    id: u.userId,
    name,
    email: u.email,
    role: 'member',
    joinedAt: u.createdAt,
    avatarUrl: undefined,
  };
}

export function TeamContent({ orgId }: TeamContentProps) {
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [members, setMembers] = useState<TeamMember[]>([]);

  // Organization still loaded via existing hook
  const {
    data: orgData,
    isLoading: isOrgLoading,
    isError: isOrgError,
  } = useOrganization(orgId);

  // Members now loaded from new endpoint via dedicated hook
  const {
    data: usersRes,
    isLoading: isUsersLoading,
    isError: isUsersError,
    mutate: refreshUsers,
  } = useUsersList(orgId, {
    search: searchQuery,
    limit: 200,
  });

  // Map API users → TeamMember
  const loadedMembers = useMemo(() => {
    const items = usersRes?.items ?? [];
    return items.map(toTeamMember);
  }, [usersRes?.items]);

  // Keep local members state for optimistic updates (add/update/remove)
  useEffect(() => {
    setMembers(loadedMembers);
  }, [loadedMembers]);

  // Error toast
  useEffect(() => {
    if (isOrgError || isUsersError) {
      toast({
        title: 'Error',
        description: 'Failed to load team data',
        variant: 'destructive',
      });
    }
  }, [isOrgError, isUsersError, toast]);

  const isLoading = isOrgLoading || isUsersLoading;

  // Local handlers for optimistic UX (and refresh server list afterward)
  const handleMemberAdded = useCallback(
    async (newMember: TeamMember) => {
      setMembers((prev) => [...prev, newMember]);
      // In case backend auto-normalizes roles/names, refresh
      await refreshUsers();
    },
    [refreshUsers],
  );

  const handleMemberUpdated = useCallback(
    async (updatedMember: TeamMember) => {
      setMembers((prev) => prev.map((m) => (m.id === updatedMember.id ? updatedMember : m)));
      await refreshUsers();
    },
    [refreshUsers],
  );

  const handleMemberRemoved = useCallback(
    async (memberId: string) => {
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
      await refreshUsers();
    },
    [refreshUsers],
  );

  // Client-side filter is no longer needed (server search is used),
  // but keep it as a safety net (e.g., if API doesn’t support search yet).
  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        (m.name?.toLowerCase().includes(q) ?? false) ||
        (m.email?.toLowerCase().includes(q) ?? false),
    );
  }, [members, searchQuery]);

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
            organizationName={(orgData as any)?.name}
            isLoading={isLoading}
            onMemberUpdated={handleMemberUpdated}
            onMemberRemoved={handleMemberRemoved}
          />
        </div>
      </div>
    </div>
  );
}
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import { InviteMemberDialog } from './InviteMemberDialog';
import type { TeamMember } from './types';

import { useOrganization } from '@/lib/hooks/use-api';
import type { UserListItem } from '@auto-rfp/core';
import { useUsersList } from '@/lib/hooks/use-user';
import { MemberRow } from '@/components/organizations/MemberRow';
import { PageSearch } from '@/components/layout/page-search';

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
    firstName: u.firstName,
    lastName: u.lastName,
    displayName: u.displayName,
    phone: u.phone,
    role: u.role,
    status: u.status,
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

  // Client-side filter as safety net
  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        (m.name?.toLowerCase().includes(q) ?? false) ||
        (m.email?.toLowerCase().includes(q) ?? false),
    );
  }, [members, searchQuery]);

  const handleReload = useCallback(async () => {
    await refreshUsers();
  }, [refreshUsers]);

  return (
    <div className="container mx-auto p-6 md:p-12">
      <ListingPageLayout
        title="Org Members"
        description={`${filteredMembers.length} member${filteredMembers.length !== 1 ? 's' : ''} in your organization`}
        headerActions={
          <>
            <PageSearch value={searchQuery} onChange={setSearchQuery} placeholder="Search members…" />
            <InviteMemberDialog orgId={orgId} onMemberAdded={handleMemberAdded} />
          </>
        }
        isLoading={isLoading}
        onReload={handleReload}
        emptyState={
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold">No org members found</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {searchQuery
                ? `No members match "${searchQuery}". Try a different search term.`
                : 'Get started by inviting your first team member.'}
            </p>
          </div>
        }
        renderItem={(member: TeamMember) => (
          <MemberRow
            key={member.id}
            member={member}
            orgId={orgId}
            onMemberUpdated={handleMemberUpdated}
            onMemberRemoved={handleMemberRemoved}
          />
        )}
        data={filteredMembers}
      />
    </div>
  );
}

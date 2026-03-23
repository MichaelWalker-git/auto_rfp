'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, Shield, UserPlus, X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { grantKBAccessApi, revokeKBAccessApi, useUsersList, useKBAccessUsers } from '@/lib/hooks/use-user';
import { invalidateKBAccessCaches } from '@/lib/helpers/kb-access-cache';
import { useAuth } from '@/components/AuthProvider';
import { useCanManageKBAccess } from './hooks/useCanManageKBAccess';

interface KBAccessControlProps {
  kbId: string;
  orgId: string;
}

export function KBAccessControl({ kbId, orgId }: KBAccessControlProps) {
  const { toast } = useToast();
  const { userSub } = useAuth();

  const { data: usersData, isLoading: isLoadingUsers } = useUsersList(orgId, { limit: 200 });
  const { data: accessData } = useKBAccessUsers(kbId, orgId);
  const { canManage: canManageKBAccess, isLoading: isLoadingAccess } = useCanManageKBAccess(kbId, orgId);

  // Filter users list - always exclude self from the dropdown
  const allUsers = (usersData?.items ?? []).filter((u) => u.userId !== userSub);

  // Set of userIds who already have KB access
  const grantedUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const record of accessData?.users ?? []) {
      ids.add(record.userId);
    }
    return ids;
  }, [accessData]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<Map<string, { name: string; email: string }>>(new Map());
  const [isGranting, setIsGranting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter users by search query, excluding already selected
  // Show all available users when dropdown is open (no search required)
  const filteredUsers = useMemo(() => {
    const availableUsers = allUsers.filter(
      (u) => !selectedUsers.has(u.userId) && !grantedUserIds.has(u.userId)
    );

    // If no search query, return all available users (limited)
    if (!searchQuery.trim()) {
      return availableUsers.slice(0, 10);
    }

    // Filter by search query
    const q = searchQuery.toLowerCase();
    return availableUsers
      .filter((u) =>
        u.email?.toLowerCase().includes(q) ||
        u.firstName?.toLowerCase().includes(q) ||
        u.lastName?.toLowerCase().includes(q) ||
        u.displayName?.toLowerCase().includes(q)
      )
      .slice(0, 10);
  }, [searchQuery, allUsers, selectedUsers, grantedUserIds]);

  const addUser = useCallback((userId: string, name: string, email: string) => {
    setSelectedUsers((prev) => {
      const next = new Map(prev);
      next.set(userId, { name, email });
      return next;
    });
    setSearchQuery('');
    setShowDropdown(false);
  }, []);

  const removeUser = useCallback((userId: string) => {
    setSelectedUsers((prev) => {
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
  }, []);

  const handleGrantAccess = useCallback(async () => {
    if (selectedUsers.size === 0) return;
    setIsGranting(true);
    let granted = 0;
    let errors = 0;

    for (const [userId] of selectedUsers) {
      try {
        await grantKBAccessApi({ userId, kbId, orgId, accessLevel: 'read' });
        granted++;
      } catch {
        errors++;
      }
    }

    // Revalidate both KB→user and user→KB caches
    for (const [userId] of selectedUsers) {
      invalidateKBAccessCaches(userId, kbId);
    }

    toast({
      title: 'Access granted',
      description: `${granted} user(s) granted access${errors > 0 ? `, ${errors} failed` : ''}`,
    });

    setSelectedUsers(new Map());
    setIsGranting(false);
  }, [selectedUsers, kbId, orgId, toast]);

  const handleRevokeAccess = useCallback(async (userId: string, email: string) => {
    try {
      await revokeKBAccessApi({ userId, kbId, orgId });

      // Revalidate both KB→user and user→KB caches
      invalidateKBAccessCaches(userId, kbId);

      toast({ title: 'Access revoked', description: `${email} access removed` });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message ?? 'Failed to revoke', variant: 'destructive' });
    }
  }, [kbId, toast]);

  // Don't render if still loading or user cannot manage KB access
  if (isLoadingAccess) {
    return (
      <Card>
        <CardHeader>
          You can't manage access for this knowlenge base
        </CardHeader>
      </Card>
    );
  }

  if (!canManageKBAccess) {
    return (
      <Card>
        <CardHeader>
          You can't manage access for this knowlenge base
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Access Control
        </CardTitle>
        <CardDescription>
          Search and add team members who should have access to this knowledge base.
        </CardDescription>
      </CardHeader>
        <CardContent className="space-y-4">
          {/* Selected users tags */}
          {selectedUsers.size > 0 && (
            <div className="flex flex-wrap gap-2">
              {Array.from(selectedUsers.entries()).map(([userId, { name, email }]) => (
                <Badge key={userId} variant="secondary" className="gap-1 py-1 px-2">
                  {name || email}
                  <button
                    type="button"
                    onClick={() => removeUser(userId)}
                    className="ml-1 rounded-full hover:bg-muted"
                    aria-label={`Remove ${name || email}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {/* Search + Grant button */}
          <div className="flex gap-2">
            <div className="relative flex-1" ref={dropdownRef}>
              <Input
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                className="h-9"
              />

              {/* Search dropdown */}
              {showDropdown && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border bg-popover shadow-md max-h-[200px] overflow-y-auto">
                  {filteredUsers.length > 0 ? (
                    <>
                      {filteredUsers.map((user) => {
                        const displayName = user.displayName
                          || [user.firstName, user.lastName].filter(Boolean).join(' ')
                          || user.email;
                        return (
                          <button
                            key={user.userId}
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                            onClick={() => addUser(user.userId, displayName, user.email)}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{displayName}</p>
                              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0">{user.role}</Badge>
                          </button>
                        );
                      })}
                      {/* Show hint if more users available */}
                      {allUsers.filter((u) => !selectedUsers.has(u.userId) && !grantedUserIds.has(u.userId)).length > 10 && (
                        <p className="text-xs text-muted-foreground text-center py-2 border-t">
                          Type to search more users...
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-3">
                      {searchQuery.trim()
                        ? 'No users found matching your search'
                        : 'No available users to add'}
                    </p>
                  )}
                </div>
              )}
            </div>

            <Button
              onClick={handleGrantAccess}
              disabled={selectedUsers.size === 0 || isGranting}
              className="h-9 shrink-0"
            >
              {isGranting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <><UserPlus className="h-4 w-4 mr-2" /> Grant Access ({selectedUsers.size})</>
              )}
            </Button>
          </div>

          {/* Currently Granted Users */}
          <GrantedUsersList kbId={kbId} orgId={orgId} allUsers={allUsers} onRevoke={handleRevokeAccess} />

          {isLoadingUsers && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </CardContent>
    </Card>
  );
}

// ─── Sub-component: Granted Users List ───

function GrantedUsersList({
  kbId,
  orgId,
  allUsers,
  onRevoke,
}: {
  kbId: string;
  orgId: string;
  allUsers: Array<{ userId: string; email: string; firstName?: string; lastName?: string; displayName?: string; role: string }>;
  onRevoke: (userId: string, email: string) => Promise<void>;
}) {
  const { data: accessData, isLoading } = useKBAccessUsers(kbId, orgId);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const grantedUsers = useMemo(() => {
    const accessRecords = accessData?.users ?? [];
    if (accessRecords.length === 0) return [];

    const userMap = new Map(allUsers.map((u) => [u.userId, u]));
    return accessRecords.map((record) => {
      const user = userMap.get(record.userId);
      return {
        ...record,
        displayName: user?.displayName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || record.userId.slice(0, 8) + '…',
        email: user?.email || '',
        role: user?.role || '',
      };
    });
  }, [accessData, allUsers]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading access list...
      </div>
    );
  }

  if (grantedUsers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No specific access configured — all organization members can access this KB.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">
        Users with Access ({grantedUsers.length})
      </p>
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {grantedUsers.map((user) => (
          <div
            key={user.userId}
            className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.displayName}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className="text-xs">{user.accessLevel}</Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                disabled={revokingId === user.userId}
                onClick={async () => {
                  setRevokingId(user.userId);
                  await onRevoke(user.userId, user.email);
                  setRevokingId(null);
                }}
              >
                {revokingId === user.userId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

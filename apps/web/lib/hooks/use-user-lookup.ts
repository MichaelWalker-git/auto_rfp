'use client';

import { useMemo } from 'react';
import type { UserListItem } from '@auto-rfp/core';

/**
 * Extended user type that includes deletion status for display purposes
 */
export interface UserLookupResult {
  userId: string;
  displayName: string;
  email: string | undefined;
  firstName: string | undefined;
  lastName: string | undefined;
  role: string | undefined;
  isDeleted: boolean;
  avatarInitials: string;
  user: UserListItem | null;
}

/**
 * Looks up a user by ID in the organization's user list.
 * Returns a safe fallback object for deleted/missing users.
 *
 * @param userId - The user ID to look up
 * @param orgUsers - The list of users in the organization
 * @returns UserLookupResult with isDeleted flag for missing users
 */
export const useUserLookup = (
  userId: string | undefined,
  orgUsers: UserListItem[]
): UserLookupResult | null => {
  return useMemo(() => {
    if (!userId) return null;

    const user = orgUsers.find((u) => u.userId === userId);

    if (!user) {
      // User not found in org - likely deleted
      return {
        userId,
        displayName: 'Unknown user (probably deleted)',
        email: undefined,
        firstName: undefined,
        lastName: undefined,
        role: undefined,
        isDeleted: true,
        avatarInitials: '?',
        user: null,
      };
    }

    // User found - construct display name
    const displayName =
      user.displayName ||
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      user.email ||
      'Unknown';

    const avatarInitials = displayName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    return {
      userId: user.userId,
      displayName,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isDeleted: false,
      avatarInitials,
      user,
    };
  }, [userId, orgUsers]);
};

/**
 * Batch lookup multiple users at once.
 * More efficient than calling useUserLookup multiple times.
 */
export const useUserLookupBatch = (
  userIds: (string | undefined)[],
  orgUsers: UserListItem[]
): Map<string, UserLookupResult> => {
  return useMemo(() => {
    const results = new Map<string, UserLookupResult>();

    userIds.forEach((userId) => {
      if (!userId) return;

      const user = orgUsers.find((u) => u.userId === userId);

      if (!user) {
        results.set(userId, {
          userId,
          displayName: 'Unknown user (probably deleted)',
          email: undefined,
          firstName: undefined,
          lastName: undefined,
          role: undefined,
          isDeleted: true,
          avatarInitials: '?',
          user: null,
        });
      } else {
        const displayName =
          user.displayName ||
          [user.firstName, user.lastName].filter(Boolean).join(' ') ||
          user.email ||
          'Unknown';

        const avatarInitials = displayName
          .split(' ')
          .map((n) => n[0])
          .join('')
          .slice(0, 2)
          .toUpperCase();

        results.set(userId, {
          userId: user.userId,
          displayName,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isDeleted: false,
          avatarInitials,
          user,
        });
      }
    });

    return results;
  }, [userIds, orgUsers]);
};

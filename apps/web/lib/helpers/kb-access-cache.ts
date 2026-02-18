import { mutate as globalMutate } from 'swr';

/**
 * Invalidate both KB→user and user→KB SWR caches.
 * Should be called after any grant/revoke operation to keep both views in sync.
 */
export function invalidateKBAccessCaches(userId: string, kbId: string) {
  // Invalidate "which users have access to KB X" (used by KBAccessControl)
  globalMutate(
    (key: unknown) => Array.isArray(key) && key[0] === 'kb-access-users' && key[1] === kbId,
    undefined,
    { revalidate: true },
  );

  // Invalidate "which KBs does user X have access to" (used by ManageUserKBAccessDialog)
  globalMutate(
    (key: unknown) => Array.isArray(key) && key[0] === 'user-kb-access' && key[1] === userId,
    undefined,
    { revalidate: true },
  );
}

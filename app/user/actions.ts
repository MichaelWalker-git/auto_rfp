'use server';

import { getCurrentUser } from '@/lib/utils/cognito/client';

export async function getCurrentUserEmail(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    
    if (!user) {
      return null;
    }

    // For now, return a mock email since we don't have real Cognito implementation
    return 'user@example.com';
  } catch (e) {
    console.error('Exception fetching user email:', e);
    return null;
  }
}

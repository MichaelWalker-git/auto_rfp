/**
 * Session storage utility for persisting selected opportunity per project.
 * Allows opportunity selection to persist across navigation within the same session.
 */

const STORAGE_KEY_PREFIX = 'selectedOpportunity';

/**
 * Get the storage key for a project
 */
const getStorageKey = (projectId: string): string => `${STORAGE_KEY_PREFIX}:${projectId}`;

/**
 * Save selected opportunity ID for a project
 */
export const saveSelectedOpportunity = (projectId: string, opportunityId: string): void => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(getStorageKey(projectId), opportunityId);
  } catch (err) {
    console.warn('Failed to save opportunity selection to sessionStorage:', err);
  }
};

/**
 * Get saved opportunity ID for a project
 * Returns null if not found
 */
export const getSelectedOpportunity = (projectId: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(getStorageKey(projectId));
  } catch (err) {
    console.warn('Failed to read opportunity selection from sessionStorage:', err);
    return null;
  }
};

/**
 * Clear saved opportunity for a project
 */
export const clearSelectedOpportunity = (projectId: string): void => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(getStorageKey(projectId));
  } catch (err) {
    console.warn('Failed to clear opportunity selection from sessionStorage:', err);
  }
};

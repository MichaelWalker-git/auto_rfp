export const ORG_STORAGE_KEY = 'auto-rfp:selectedOrgId';

export function readStoredOrgId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ORG_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredOrgId(orgId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (!orgId) window.localStorage.removeItem(ORG_STORAGE_KEY);
    else window.localStorage.setItem(ORG_STORAGE_KEY, orgId);
  } catch {
    // ignore
  }
}

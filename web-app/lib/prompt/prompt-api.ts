import { env } from '@/lib/env';

const BASE = `${env.BASE_API_URL}/prompt`;

export const promptApi = {
  list: (orgId?: string) => `${BASE}/get-prompts${orgId ? `?orgId=${orgId}` : ''}`,
  save: (scope: 'SYSTEM' | 'USER') => `${BASE}/save-prompt/${scope}`,
};

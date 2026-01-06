import { env } from '@/lib/env';

const BASE = `${env.BASE_API_URL}/prompt`;

export const promptApi = {
  list: () => `${BASE}/get-prompts`,
  save: (scope: 'SYSTEM' | 'USER') => `${BASE}/save-prompt/${scope}`,
};

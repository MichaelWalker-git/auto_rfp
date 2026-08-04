import { env } from '@/lib/env';

import type { PromptScope } from '@auto-rfp/core';

const BASE = `${env.BASE_API_URL}/prompt`;

const orgQuery = (orgId?: string) => (orgId ? `?orgId=${orgId}` : '');

export const promptApi = {
  list: (orgId?: string) => `${BASE}/get-prompts${orgQuery(orgId)}`,
  save: (scope: PromptScope, orgId?: string) =>
    `${BASE}/save-prompt/${scope}${orgQuery(orgId)}`,
  delete: (scope: PromptScope, orgId?: string) =>
    `${BASE}/delete-prompt/${scope}${orgQuery(orgId)}`,
};

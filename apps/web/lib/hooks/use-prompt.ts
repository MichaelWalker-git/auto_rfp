'use client';

import useSWRMutation from 'swr/mutation';

import { authFetcher } from '@/lib/auth/auth-fetcher';
import { useApi } from '@/lib/hooks/use-api';
import { promptApi } from '@/lib/prompt/prompt-api';

import { type PromptItem, type PromptScope, type PromptType } from '@auto-rfp/core';

// Manually define response types to avoid deep Zod type instantiation (TS2589)
export interface PromptListResponse {
  ok: boolean;
  items: {
    system: PromptItem[];
    user: PromptItem[];
  };
}

export interface SavePromptResponse {
  ok: boolean;
  item: PromptItem;
}

export interface SavePromptBody {
  type: PromptType;
  prompt: string;
  params?: string[];
}

export type SavePromptArgs = SavePromptBody & {
  scope: PromptScope;
};

// Simple runtime validation
const validatePromptListResponse = (data: unknown): PromptListResponse | null => {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.ok !== 'boolean') return null;
  if (!obj.items || typeof obj.items !== 'object') return null;

  const items = obj.items as Record<string, unknown>;
  const system = (items as { system?: unknown }).system;
  const user = (items as { user?: unknown }).user;

  if (!Array.isArray(system) || !Array.isArray(user)) return null;

  return {
    ok: obj.ok as boolean,
    items: {
      system: system as PromptItem[],
      user: user as PromptItem[],
    },
  };
};

const validateSavePromptResponse = (data: unknown): SavePromptResponse | null => {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.ok !== 'boolean') return null;
  if (!obj.item || typeof obj.item !== 'object') return null;
  return data as SavePromptResponse;
};

// NOTE: These runtime validation arrays must be kept in sync with the Zod schemas
// in the @auto-rfp/core package that define PromptScope and PromptType.
// If new scopes or types are added there, they must be added here as well.
const validScopes: PromptScope[] = ['SYSTEM', 'USER'];
const validTypes: PromptType[] = ['PROPOSAL', 'SUMMARY', 'REQUIREMENTS', 'CONTACTS', 'RISK', 'DEADLINE', 'SCORING', 'ANSWER'];

export function usePrompts(orgId?: string) {
  const url = promptApi.list(orgId);
  const key = ['prompts', url] as const;

  const { data, error, isLoading, mutate } = useApi<unknown>([...key], url);

  const parsed = data ? validatePromptListResponse(data) : null;

  return {
    system: parsed?.items.system ?? [],
    user: parsed?.items.user ?? [],
    error: error ?? (data && !parsed ? new Error('Invalid response format') : null),
    isLoading,
    refresh: mutate,
  };
}

export function useSavePrompt() {
  return useSWRMutation<PromptItem, Error, string, SavePromptArgs>(
    'prompt/save-prompt',
    async (_key, { arg }) => {
      // Validate scope
      if (!validScopes.includes(arg.scope)) {
        throw new Error('Invalid scope. Use SYSTEM or USER.');
      }

      // Validate body
      if (!validTypes.includes(arg.type)) {
        throw new Error('Invalid type.');
      }
      if (!arg.prompt || arg.prompt.length < 1) {
        throw new Error('prompt is required');
      }
      if (arg.params !== undefined && arg.params !== null) {
        if (!Array.isArray(arg.params) || !arg.params.every((p) => typeof p === 'string')) {
          throw new Error('params must be an array of strings when provided');
        }
      }

      const url = promptApi.save(arg.scope);
      const body: SavePromptBody = {
        type: arg.type,
        prompt: arg.prompt,
        params: arg.params,
      };

      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const err = new Error(message || 'Failed to save prompt') as Error & { status?: number };
        err.status = res.status;
        throw err;
      }

      const json = await res.json().catch(() => {
        throw new Error('Invalid JSON returned from API');
      });

      const parsed = validateSavePromptResponse(json);
      if (!parsed) {
        throw new Error('API returned invalid save response');
      }

      return parsed.item;
    },
  );
}

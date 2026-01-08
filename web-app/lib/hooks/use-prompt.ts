'use client';

import useSWRMutation from 'swr/mutation';
import { z } from 'zod';

import { authFetcher } from '@/lib/auth/auth-fetcher';
import { useApi } from '@/lib/hooks/use-api';
import { promptApi } from '@/lib/prompt/prompt-api';

import { type PromptItem, PromptItemSchema, PromptScopeSchema, SavePromptBodySchema, } from '@auto-rfp/shared';

const PromptListResponseSchema = z.object({
  ok: z.boolean(),
  items: z.object({
    system: z.array(PromptItemSchema).default([]),
    user: z.array(PromptItemSchema).default([]),
  }),
});

export type PromptListResponse = z.infer<typeof PromptListResponseSchema>;

const SavePromptResponseSchema = z.object({
  ok: z.boolean(),
  item: PromptItemSchema,
});

export type SavePromptResponse = z.infer<typeof SavePromptResponseSchema>;

export function usePrompts(orgId?: string) {
  const url = promptApi.list(orgId);
  const key = ['prompts', url] as const;

  const { data, error, isLoading, mutate } = useApi<unknown>(key as any, url);

  const parsed = data ? PromptListResponseSchema.safeParse(data) : null;

  return {
    system: parsed?.success ? parsed.data.items.system : [],
    user: parsed?.success ? parsed.data.items.user : [],
    error: error ?? (parsed && !parsed.success ? parsed.error : null),
    isLoading,
    refresh: mutate,
  };
}

export type SavePromptArgs = z.infer<typeof SavePromptBodySchema> & {
  scope: z.infer<typeof PromptScopeSchema>; // 'SYSTEM' | 'USER'
};

export function useSavePrompt() {
  return useSWRMutation<PromptItem, any, string, SavePromptArgs>(
    'prompt/save-prompt',
    async (_key, { arg }) => {
      const scopeParsed = PromptScopeSchema.safeParse(arg.scope);
      if (!scopeParsed.success) {
        throw new Error('Invalid scope. Use SYSTEM or USER.');
      }

      const bodyParsed = SavePromptBodySchema.safeParse(arg);
      if (!bodyParsed.success) {
        throw new Error(bodyParsed.error.issues.join(', '));
      }

      const url = promptApi.save(scopeParsed.data);

      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(bodyParsed.data),
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

      const parsed = SavePromptResponseSchema.safeParse(json);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new Error(`API returned invalid save response: ${issues}`);
      }

      return parsed.data.item;
    },
  );
}

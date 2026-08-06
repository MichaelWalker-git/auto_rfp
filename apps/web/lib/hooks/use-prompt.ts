'use client';

import useSWRMutation from 'swr/mutation';

import { authFetcher } from '@/lib/auth/auth-fetcher';
import { useApi } from '@/lib/hooks/use-api';
import { promptApi } from '@/lib/prompt/prompt-api';

import {
  DOCUMENT_PROMPT_MAX_LENGTH,
  DocumentPromptTypeSchema,
  PromptScopeSchema,
  PromptTypeSchema,
  type DeleteDocumentPromptBody,
  type DocumentPromptItem,
  type DocumentPromptType,
  type PromptItem,
  type PromptScope,
  type PromptType,
  type SaveDocumentPromptBody,
} from '@auto-rfp/core';

// Manually define response types to avoid deep Zod type instantiation (TS2589)
export interface PromptListResponse {
  ok: boolean;
  items: {
    system: PromptItem[];
    user: PromptItem[];
    document: DocumentPromptItem[];
  };
}

export interface SavePromptResponse {
  ok: boolean;
  item: PromptItem | DocumentPromptItem;
}

export interface SavePromptBody {
  type: PromptType;
  prompt: string;
  params?: string[];
}

export type { DeleteDocumentPromptBody, SaveDocumentPromptBody };

export type SavePromptArgs = (SavePromptBody | SaveDocumentPromptBody) & {
  scope: PromptScope;
  orgId?: string;
};

export type DeletePromptArgs = DeleteDocumentPromptBody & {
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
  const document = (items as { document?: unknown }).document;

  if (!Array.isArray(system) || !Array.isArray(user)) return null;
  // `document` group is additive — tolerate its absence (older API responses)
  if (document !== undefined && !Array.isArray(document)) return null;

  return {
    ok: obj.ok as boolean,
    items: {
      system: system as PromptItem[],
      user: user as PromptItem[],
      document: (document ?? []) as DocumentPromptItem[],
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

// Runtime validation values sourced from the core Zod schemas so they can't
// drift when new scopes/types are added there.
const validScopes: readonly PromptScope[] = PromptScopeSchema.options;
const validTypes: readonly PromptType[] = PromptTypeSchema.options;
const validDocumentTypes: readonly DocumentPromptType[] = DocumentPromptTypeSchema.options;

const isDocumentPromptArgs = (
  arg: SavePromptArgs,
): arg is SaveDocumentPromptBody & { scope: PromptScope; orgId?: string } =>
  'documentType' in arg;

const throwResponseError = async (res: Response, fallbackMessage: string): Promise<never> => {
  const message = await res.text().catch(() => '');
  const err = new Error(message || fallbackMessage) as Error & { status?: number };
  err.status = res.status;
  throw err;
};

export function usePrompts(orgId?: string) {
  // Don't fetch until orgId is available - the API requires it
  const shouldFetch = Boolean(orgId);
  const url = shouldFetch ? promptApi.list(orgId) : null;
  const key = url ? ['prompts', url] : null;

  const { data, error, isLoading, mutate } = useApi<unknown>(key, url ?? '');

  const parsed = data ? validatePromptListResponse(data) : null;

  return {
    system: parsed?.items.system ?? [],
    user: parsed?.items.user ?? [],
    document: parsed?.items.document ?? [],
    error: error ?? (data && !parsed ? new Error('Invalid response format') : null),
    isLoading: shouldFetch ? isLoading : false,
    refresh: mutate,
  };
}

export function useSavePrompt(orgId?: string) {
  return useSWRMutation<PromptItem | DocumentPromptItem, Error, string, SavePromptArgs>(
    `prompt/save-prompt${orgId ? `?orgId=${orgId}` : ''}`,
    async (_key, { arg }) => {
      // Validate scope
      if (!validScopes.includes(arg.scope)) {
        throw new Error('Invalid scope. Use SYSTEM or USER.');
      }

      let body: SavePromptBody | SaveDocumentPromptBody;
      if (isDocumentPromptArgs(arg)) {
        // Document-generation prompt override — mirrors SaveDocumentPromptBodySchema
        if (!validDocumentTypes.includes(arg.documentType)) {
          throw new Error('Invalid documentType.');
        }
        if (!arg.prompt || arg.prompt.trim().length < 1) {
          throw new Error('prompt is required');
        }
        if (arg.prompt.length > DOCUMENT_PROMPT_MAX_LENGTH) {
          throw new Error(`prompt must be at most ${DOCUMENT_PROMPT_MAX_LENGTH} characters`);
        }
        body = {
          documentType: arg.documentType,
          prompt: arg.prompt,
        };
      } else {
        // Feature prompt
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
        body = {
          type: arg.type,
          prompt: arg.prompt,
          params: arg.params,
        };
      }

      const url = promptApi.save(arg.scope, orgId);

      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        await throwResponseError(res, 'Failed to save prompt');
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

/** Reset a document-generation prompt override to its default (deletes the org row). */
export function useDeletePrompt(orgId?: string) {
  return useSWRMutation<boolean, Error, string, DeletePromptArgs>(
    `prompt/delete-prompt${orgId ? `?orgId=${orgId}` : ''}`,
    async (_key, { arg }) => {
      if (!validScopes.includes(arg.scope)) {
        throw new Error('Invalid scope. Use SYSTEM or USER.');
      }
      if (!validDocumentTypes.includes(arg.documentType)) {
        throw new Error('Invalid documentType.');
      }

      const url = promptApi.delete(arg.scope, orgId);

      const res = await authFetcher(url, {
        method: 'DELETE',
        body: JSON.stringify({ documentType: arg.documentType }),
      });

      if (!res.ok) {
        await throwResponseError(res, 'Failed to delete prompt');
      }

      return true;
    },
  );
}

'use client';

import { ApiKeyConfiguration } from './ApiKeyConfiguration';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';

interface HigherGovApiKeyConfigurationProps {
  orgId: string;
}

export function HigherGovApiKeyConfiguration({ orgId }: HigherGovApiKeyConfigurationProps) {
  const url = orgId
    ? `${env.BASE_API_URL}/search-opportunities/api-key?source=HIGHER_GOV&orgId=${encodeURIComponent(orgId)}`
    : null;

  const { data, isLoading, mutate } = useSWR<{ orgId: string; apiKey: string | null }>(
    url,
    async (u: string) => {
      const res = await authFetcher(u);
      if (!res.ok) return { orgId, apiKey: null };
      return res.json();
    },
    { revalidateOnFocus: false },
  );

  const setUrl = `${env.BASE_API_URL}/search-opportunities/api-key`;
  const { trigger: setKey } = useSWRMutation<
    { ok: boolean; orgId: string },
    Error,
    string,
    { source: string; orgId: string; apiKey: string }
  >(setUrl, async (u, { arg }) => {
    const res = await authFetcher(u, { method: 'POST', body: JSON.stringify(arg) });
    if (!res.ok) throw new Error(`Failed to save HigherGov API key: ${res.status}`);
    return res.json();
  });

  const saveKey = async (apiKey: string) => {
    await setKey({ source: 'HIGHER_GOV', orgId, apiKey });
  };

  return (
    <ApiKeyConfiguration
      title="HigherGov API Key"
      description="Connect to HigherGov to search and import government opportunities across SAM.gov, DIBBS, SBIR, grants, and state/local sources"
      orgId={orgId}
      apiKeyHook={{
        apiKey: data?.apiKey,
        isLoading,
        mutate,
      }}
      saveKey={saveKey}
      helpText={{
        title: 'How to get a HigherGov API Key',
        steps: [
          'Log in to your HigherGov account at highergov.com',
          'Click the gear icon to open Settings',
          'Navigate to the API section (or visit highergov.com/api-management/)',
          'Click "Create API Key" (only account administrators can do this)',
          'Copy the generated API key immediately — it is shown only once',
          'Paste the API key here',
        ],
        linkText: 'HigherGov API Docs',
        linkUrl: 'https://docs.highergov.com/import-and-export/api',
      }}
    />
  );
}
'use client';

import { ApiKeyConfiguration } from './ApiKeyConfiguration';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';

interface DibbsApiKeyConfigurationProps {
  orgId: string;
}

export function DibbsApiKeyConfiguration({ orgId }: DibbsApiKeyConfigurationProps) {
  const url = orgId
    ? `${env.BASE_API_URL}/search-opportunities/api-key?source=DIBBS&orgId=${encodeURIComponent(orgId)}`
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
    if (!res.ok) throw new Error(`Failed to save DIBBS API key: ${res.status}`);
    return res.json();
  });

  const saveKey = async (apiKey: string) => {
    await setKey({ source: 'DIBBS', orgId, apiKey });
  };

  return (
    <ApiKeyConfiguration
      title="DIBBS API Key"
      description="Configure your DIBBS (Defense Industrial Base Bidding System) API key for DoD opportunity searches"
      orgId={orgId}
      apiKeyHook={{
        apiKey: data?.apiKey,
        isLoading,
        mutate,
      }}
      saveKey={saveKey}
      helpText={{
        title: 'How to get a DIBBS API Key',
        steps: [
          'Visit the DIBBS portal at dibbs.bsm.dla.mil',
          'Create an account or log in with your CAC/PIV credentials',
          'Navigate to your account settings or API access section',
          'Request API access and generate an API key',
          'Copy the generated API key and paste it here',
        ],
        linkText: 'Visit DIBBS Portal',
        linkUrl: 'https://www.dibbs.bsm.dla.mil',
      }}
    />
  );
}

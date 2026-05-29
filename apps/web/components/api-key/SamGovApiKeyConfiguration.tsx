'use client';

import { ApiKeyConfiguration } from './ApiKeyConfiguration';
import { useGetApiKey } from '@/lib/hooks/use-get-api-key';
import { useSetApiKey } from '@/lib/hooks/use-set-api-key';

interface SamGovApiKeyConfigurationProps {
  orgId: string;
}

export function SamGovApiKeyConfiguration({ orgId }: SamGovApiKeyConfigurationProps) {
  const apiKeyHook = useGetApiKey(orgId);
  const { setApiKey } = useSetApiKey(orgId);

  return (
    <ApiKeyConfiguration
      title="SAM.gov API Key"
      description="Configure your SAM.gov API key for opportunity searches"
      orgId={orgId}
      apiKeyHook={{
        apiKey: apiKeyHook.apiKey,
        isLoading: apiKeyHook.isLoading,
        mutate: apiKeyHook.mutate
      }}
      saveKey={setApiKey}
      helpText={{
        title: "How to get a SAM.gov API Key",
        steps: [
          "Create an account at SAM.gov if you don't have one",
          "Go to your account settings",
          "Navigate to the \"System Accounts\" section",
          "Create a new system account for API access",
          "Copy the generated API key"
        ],
        linkText: "Visit SAM.gov",
        linkUrl: "https://sam.gov/content/home"
      }}
    />
  );
}
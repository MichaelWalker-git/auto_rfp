'use client';

import { ApiKeyConfiguration } from './ApiKeyConfiguration';
import { useGetLinearApiKey, useSetLinearApiKey } from '@/lib/hooks/use-linear-api-key';

interface LinearApiKeyConfigurationProps {
  orgId: string;
}

export function LinearApiKeyConfiguration({ orgId }: LinearApiKeyConfigurationProps) {
  const apiKeyHook = useGetLinearApiKey(orgId);
  const { setApiKey } = useSetLinearApiKey(orgId);

  return (
    <ApiKeyConfiguration
      title="Linear API Key"
      description="Configure your Linear API key for project management integration"
      orgId={orgId}
      apiKeyHook={apiKeyHook}
      saveKey={setApiKey}
      helpText={{
        title: "How to get a Linear API Key",
        steps: [
          "Go to Linear and open Settings",
          "Navigate to \"API\" under \"My Account\"",
          "Click \"Create new API key\"",
          "Give it a descriptive name (e.g., \"AutoRFP Integration\")",
          "Copy the generated API key"
        ],
        linkText: "Open Linear API Settings",
        linkUrl: "https://linear.app/settings/api"
      }}
    />
  );
}
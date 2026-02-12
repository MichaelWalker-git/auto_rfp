'use client';

import { ApiKeyConfiguration } from './ApiKeyConfiguration';
import { useGetGoogleApiKey, useSetGoogleApiKey } from '@/lib/hooks/use-google-api-key';

interface GoogleApiKeyConfigurationProps {
  orgId: string;
}

export function GoogleApiKeyConfiguration({ orgId }: GoogleApiKeyConfigurationProps) {
  const apiKeyHook = useGetGoogleApiKey(orgId);
  const { setApiKey } = useSetGoogleApiKey(orgId);

  return (
    <ApiKeyConfiguration
      title="Google API Key"
      description="Configure your Google API key for enhanced features"
      orgId={orgId}
      apiKeyHook={{
        apiKey: apiKeyHook.apiKey,
        isLoading: apiKeyHook.isLoading,
        mutate: apiKeyHook.mutate
      }}
      saveKey={setApiKey}
      helpText={{
        title: "How to get a Google API Key",
        steps: [
          "Go to the Google Cloud Console",
          "Create a new project or select an existing one",
          "Navigate to \"APIs & Services\" > \"Credentials\"",
          "Click \"Create Credentials\" > \"API Key\"",
          "Copy the generated API key",
          "Optionally restrict the key to specific APIs for security"
        ],
        linkText: "Visit Google Cloud Console",
        linkUrl: "https://console.cloud.google.com/apis/credentials"
      }}
    />
  );
}
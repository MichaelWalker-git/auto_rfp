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
      title="Google Drive Service Account"
      description="Configure your Google Service Account key for Google Drive integration"
      orgId={orgId}
      apiKeyHook={{
        apiKey: apiKeyHook.apiKey,
        isLoading: apiKeyHook.isLoading,
        mutate: apiKeyHook.mutate
      }}
      saveKey={setApiKey}
      inputType="textarea"
      inputPlaceholder='Paste the contents of your service account JSON key file here (starts with { "type": "service_account", ... })'
      helpText={{
        title: "How to get a Google Service Account Key",
        steps: [
          "Go to the Google Cloud Console",
          "Create a new project or select an existing one",
          "Enable the Google Drive API under \"APIs & Services\" > \"Library\"",
          "Navigate to \"IAM & Admin\" > \"Service Accounts\"",
          "Click \"Create Service Account\" and fill in the details",
          "Click on the created service account, go to \"Keys\" tab",
          "Click \"Add Key\" > \"Create new key\" > select JSON",
          "The JSON key file will be downloaded — paste its full contents here",
          "Share your target Google Drive folder with the service account email"
        ],
        linkText: "Visit Google Cloud Console",
        linkUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts"
      }}
    />
  );
}

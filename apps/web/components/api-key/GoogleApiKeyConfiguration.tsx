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
        title: "How to set up Google Drive integration",
        steps: [
          "Go to the Google Cloud Console and create/select a project",
          "Enable the Google Drive API under \"APIs & Services\" > \"Library\"",
          "Navigate to \"IAM & Admin\" > \"Service Accounts\" and create one",
          "Click on the service account, go to \"Keys\" tab, create a JSON key",
          "Go to admin.google.com > Security > API controls > Manage Domain Wide Delegation",
          "Add the service account's numeric Client ID with scope: https://www.googleapis.com/auth/drive",
          "Add \"delegate_email\": \"user@yourdomain.com\" to the JSON key (a real Google Workspace user)",
          "Paste the full modified JSON key contents here"
        ],
        linkText: "Visit Google Cloud Console",
        linkUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts"
      }}
    />
  );
}

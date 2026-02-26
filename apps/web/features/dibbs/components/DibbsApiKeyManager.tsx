'use client';

import { useState } from 'react';
import useSWRMutation from 'swr/mutation';
import useSWR from 'swr';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface DibbsApiKeyManagerProps {
  orgId?: string;
}

export const DibbsApiKeyManager = ({ orgId }: DibbsApiKeyManagerProps) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);

  const getUrl = orgId
    ? `${env.BASE_API_URL}/search-opportunities/api-key?source=DIBBS&orgId=${encodeURIComponent(orgId)}`
    : null;

  const { data: keyData, isLoading, error: getError, mutate } = useSWR<{ orgId: string; apiKey: string | null }>(
    getUrl,
    async (u: string) => {
      const res = await authFetcher(u);
      if (!res.ok) throw new Error(`Failed to get DIBBS API key: ${res.status}`);
      return res.json();
    },
    { revalidateOnFocus: false },
  );

  const setUrl = `${env.BASE_API_URL}/search-opportunities/api-key`;
  const { trigger: setKey, isMutating, error: setError } = useSWRMutation<
    { ok: boolean; orgId: string },
    Error,
    string,
    { orgId: string; apiKey: string }
  >(setUrl, async (u, { arg }) => {
    const res = await authFetcher(u, { method: 'POST', body: JSON.stringify(arg) });
    if (!res.ok) throw new Error(`Failed to save DIBBS API key: ${res.status}`);
    return res.json();
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !apiKeyInput.trim()) return;
    await setKey({ orgId, apiKey: apiKeyInput.trim() });
    setApiKeyInput('');
    await mutate();
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>DIBBS API Key Management</CardTitle>
        <CardDescription>Store and manage your DIBBS API key securely</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Current API Key</h3>
          {isLoading && <Skeleton className="h-10 w-full" />}
          {getError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Failed to load API key</AlertDescription>
            </Alert>
          )}
          {!isLoading && !getError && keyData?.apiKey && (
            <div className="flex items-center gap-2">
              <Input
                type={showKey ? 'text' : 'password'}
                value={keyData.apiKey}
                readOnly
                className="font-mono text-sm"
              />
              <Button variant="outline" size="icon" onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          )}
          {!isLoading && !getError && !keyData?.apiKey && (
            <p className="text-sm text-muted-foreground">No API key stored</p>
          )}
        </div>

        <div className="space-y-3 pt-4 border-t">
          <h3 className="text-sm font-medium">Set or Update API Key</h3>
          <form onSubmit={handleSave} className="flex gap-2">
            <Input
              type="password"
              placeholder="Enter your DIBBS API key"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              disabled={isMutating}
              className="flex-1"
            />
            <Button type="submit" disabled={isMutating || !apiKeyInput.trim()}>
              {isMutating ? 'Saving…' : 'Save Key'}
            </Button>
          </form>
          {setError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Failed to save API key</AlertDescription>
            </Alert>
          )}
          {!isMutating && !setError && keyData?.apiKey && apiKeyInput === '' && (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              API key saved successfully
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

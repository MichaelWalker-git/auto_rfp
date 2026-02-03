'use client';

import { useState } from 'react';
import { useSetApiKey } from '@/lib/hooks/use-set-api-key';
import { useGetApiKey } from '@/lib/hooks/use-get-api-key';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Copy } from 'lucide-react';

interface ApiKeyManagerProps {
  orgId?: string;
}

export function ApiKeyManager({ orgId }: ApiKeyManagerProps) {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const { apiKey, isLoading, isError, error, mutate } = useGetApiKey(orgId);
  const { setApiKey, isLoading: isSettingKey, isError: isErrorSetting, error: errorSetting, data: setData } = useSetApiKey(orgId);

  const handleSetApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKeyInput.trim()) return;

    try {
      await setApiKey(apiKeyInput);
      setApiKeyInput('');
      await mutate();
    } catch {
      // Error is handled and displayed below
    }
  };

  const handleCopyKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>SAM.gov API Key Management</CardTitle>
        <CardDescription>Store and manage your SAM.gov API key securely</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Display Current API Key */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Current API Key</h3>
          
          {isLoading && (
            <div className="flex items-center justify-center h-10 bg-muted rounded-md">
              <p className="text-sm text-muted-foreground">Loading...</p>
            </div>
          )}

          {isError && error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Failed to load API key: {error.details?.error || error.message}
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && !isError && apiKey && (
            <div className="flex items-center gap-2">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                readOnly
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyKey}
                title="Copy key"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}

          {!isLoading && !isError && !apiKey && (
            <div className="flex items-center justify-center h-10 bg-muted rounded-md">
              <p className="text-sm text-muted-foreground">No API key stored</p>
            </div>
          )}

          {copied && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              Copied to clipboard
            </div>
          )}
        </div>

        {/* Set/Update API Key Form */}
        <div className="space-y-3 pt-4 border-t">
          <h3 className="text-sm font-medium">Set or Update API Key</h3>
          
          <form onSubmit={handleSetApiKey} className="flex gap-2">
            <Input
              type="password"
              placeholder="Enter your SAM.gov API key"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              disabled={isSettingKey}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={isSettingKey || !apiKeyInput.trim()}
              onClick={handleSetApiKey}
            >
              {isSettingKey ? 'Saving...' : 'Save Key'}
            </Button>
          </form>

          {isErrorSetting && errorSetting && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Failed to save API key: {errorSetting.details?.error || errorSetting.message}
              </AlertDescription>
            </Alert>
          )}

          {setData && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                API key saved successfully for organization: {setData.orgId}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
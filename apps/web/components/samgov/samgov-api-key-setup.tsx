'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Key, ExternalLink, CheckCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';

interface SamGovApiKeySetupProps {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function SamGovApiKeySetup({ orgId, open, onOpenChange, onSuccess }: SamGovApiKeySetupProps) {
  const { toast } = useToast();
  const [apiKey, setApiKey] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [isValidating, setIsValidating] = React.useState(false);
  const [isValid, setIsValid] = React.useState<boolean | null>(null);

  const handleValidate = async () => {
    if (!apiKey.trim()) {
      toast({
        title: 'API Key Required',
        description: 'Please enter your SAM.gov API key',
        variant: 'destructive',
      });
      return;
    }

    setIsValidating(true);
    try {
      const response = await authFetcher(
        `${env.BASE_API_URL}/search-opportunities/samgov/validate-api-key?orgId=${encodeURIComponent(orgId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: apiKey.trim() }),
        }
      );

      const result = await response.json();
      
      if (result.valid) {
        setIsValid(true);
        toast({
          title: 'API Key Valid',
          description: 'Your SAM.gov API key has been validated successfully',
        });
      } else {
        setIsValid(false);
        toast({
          title: 'Invalid API Key',
          description: result.message || 'The API key could not be validated with SAM.gov',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error validating API key:', error);
      setIsValid(false);
      toast({
        title: 'Validation Failed',
        description: 'Could not validate the API key. Please check your connection and try again.',
        variant: 'destructive',
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      toast({
        title: 'API Key Required',
        description: 'Please enter your SAM.gov API key',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await authFetcher(
        `${env.BASE_API_URL}/search-opportunities/api-key?orgId=${encodeURIComponent(orgId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: apiKey.trim() }),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to save API key' }));
        throw new Error(error.message || 'Failed to save API key');
      }

      toast({
        title: 'API Key Saved',
        description: 'Your SAM.gov API key has been saved successfully',
      });

      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving API key:', error);
      toast({
        title: 'Save Failed',
        description: error instanceof Error ? error.message : 'Failed to save API key',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    if (!open) {
      setApiKey('');
      setIsValid(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Configure SAM.gov API Key
            </div>
          </DialogTitle>
          <DialogDescription>
            To search and import opportunities from SAM.gov, you need to configure your API key.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>How to get a SAM.gov API Key</AlertTitle>
            <AlertDescription className="space-y-2 mt-2">
              <ol className="list-decimal list-inside space-y-1 text-sm">
                <li>Create an account at SAM.gov if you don't have one</li>
                <li>Go to your account settings</li>
                <li>Navigate to the "System Accounts" section</li>
                <li>Create a new system account for API access</li>
                <li>Copy the generated API key</li>
              </ol>
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('https://sam.gov/content/home', '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Visit SAM.gov
                </Button>
              </div>
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="apiKey">SAM.gov API Key</Label>
            <div className="flex gap-2">
              <Input
                id="apiKey"
                type="password"
                placeholder="Enter your SAM.gov API key"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setIsValid(null);
                }}
                disabled={isLoading || isValidating}
              />
              <Button
                variant="outline"
                onClick={handleValidate}
                disabled={!apiKey.trim() || isValidating || isLoading}
              >
                {isValidating ? 'Validating...' : 'Validate'}
              </Button>
            </div>
            {isValid === true && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle className="h-4 w-4" />
                API key is valid
              </div>
            )}
            {isValid === false && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                API key validation failed
              </div>
            )}
          </div>

          <Alert variant="default" className="bg-muted">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Security Note</AlertTitle>
            <AlertDescription>
              Your API key will be securely stored in AWS Secrets Manager and encrypted at rest.
              It will only be accessible by your organization's authorized users.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!apiKey.trim() || isLoading}>
            {isLoading ? 'Saving...' : 'Save API Key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
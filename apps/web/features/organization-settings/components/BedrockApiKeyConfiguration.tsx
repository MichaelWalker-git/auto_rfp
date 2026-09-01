'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertCircle, Key, Loader2, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { PermissionButton } from '@/components/ui/permission-button';
import { PermissionDeleteButton } from '@/components/ui/delete-button';
import { useBedrockConfig } from '../hooks/useBedrockConfig';

interface BedrockApiKeyConfigurationProps {
  orgId: string;
}

const TITLE = 'Amazon Bedrock';
const DESCRIPTION =
  'Connect your own Amazon Bedrock API key. AI generation, chat, and embeddings for this organization run on the key you provide.';

/**
 * Per-org Bedrock settings card. Pure presentation — all get/set logic lives in
 * useBedrockConfig. Mirrors the shared ApiKeyConfiguration style but adds an
 * optional fallback-model field and surfaces the save-time probe rejection.
 */
export const BedrockApiKeyConfiguration: React.FC<BedrockApiKeyConfigurationProps> = ({ orgId }) => {
  const { toast } = useToast();
  const { status, isLoading, mutate, saveConfig, isSaving } = useBedrockConfig(orgId);

  const [showDialog, setShowDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [fallbackModelId, setFallbackModelId] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [missingModels, setMissingModels] = useState<string[] | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const configured = !!status?.configured;

  const openDialog = () => {
    setApiKey('');
    setFallbackModelId(status?.fallbackModelId ?? '');
    setMissingModels(null);
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      toast({ title: 'API Key Required', description: 'Please enter your Bedrock API key', variant: 'destructive' });
      return;
    }
    setMissingModels(null);
    try {
      const result = await saveConfig({
        apiKey,
        fallbackModelId: fallbackModelId.trim() === '' ? undefined : fallbackModelId.trim(),
      });

      if (!result.ok) {
        // Probe rejection — keep the dialog open and show which models failed.
        setMissingModels(result.missingModels ?? []);
        return;
      }

      toast({ title: 'Bedrock Configured', description: 'Your Bedrock key was validated and saved.' });
      setApiKey('');
      setShowDialog(false);
      mutate();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save Bedrock config. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await saveConfig({ apiKey: '' });
      toast({ title: 'Bedrock Key Removed', description: 'The Bedrock API key has been removed.' });
      setShowDeleteDialog(false);
      mutate();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to remove the Bedrock key.',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{TITLE}</CardTitle>
          <CardDescription>{DESCRIPTION}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">API Key</h3>
              <p className="text-sm text-muted-foreground">
                {configured ? 'Your Bedrock key is configured' : 'No Bedrock key configured'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isLoading ? (
                <Skeleton className="h-6 w-24" data-testid="bedrock-status-skeleton" />
              ) : (
                <Badge variant={configured ? 'default' : 'secondary'}>
                  {configured ? 'Configured' : 'Not Configured'}
                </Badge>
              )}
              <PermissionButton
                requiredPermission="org:manage_settings"
                size="sm"
                variant="outline"
                onClick={openDialog}
              >
                <Key className="h-4 w-4 mr-2" />
                {configured ? 'Update' : 'Configure'}
              </PermissionButton>
              {configured && (
                <PermissionDeleteButton
                  requiredPermission="org:manage_settings"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowDeleteDialog(true)}
                  deniedTooltip="You don't have permission to manage organization settings. Contact your admin."
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Configure {TITLE}
              </div>
            </DialogTitle>
            <DialogDescription>{DESCRIPTION}</DialogDescription>
          </DialogHeader>

          {missingModels && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Key rejected</AlertTitle>
              <AlertDescription className="space-y-2 mt-2">
                <p className="text-sm">
                  This key could not invoke the required models below. Enable them for the key, or
                  provide a fallback model the key can run.
                </p>
                {missingModels.length > 0 && (
                  <ul className="list-disc list-inside text-sm font-mono">
                    {missingModels.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="bedrock-api-key">API Key</Label>
            <div className="relative flex-1">
              <Input
                id="bedrock-api-key"
                type={showApiKey ? 'text' : 'password'}
                placeholder="Enter your Bedrock API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                <span className="sr-only">{showApiKey ? 'Hide' : 'Show'} API key</span>
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bedrock-fallback-model">Fallback model ID (optional)</Label>
            <Input
              id="bedrock-fallback-model"
              type="text"
              placeholder="e.g. us.anthropic.claude-sonnet-4-6"
              value={fallbackModelId}
              onChange={(e) => setFallbackModelId(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Used for text roles your key can&apos;t run. Embeddings have no fallback.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving || !apiKey.trim()}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Validating…
                </>
              ) : (
                <>
                  <Key className="mr-2 h-4 w-4" />
                  Save
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Remove {TITLE} API Key
            </DialogTitle>
            <DialogDescription>
              This will clear the stored key. AI features for this organization will stop working
              until a new key is configured.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove Key
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

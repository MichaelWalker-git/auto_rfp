'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, Key, Loader2, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

interface ApiKeyConfigurationProps {
  title: string;
  description: string;
  orgId: string;
  apiKeyHook: {
    apiKey?: string | null;
    isLoading: boolean;
    mutate: () => void;
  };
  saveKey: (apiKey: string) => Promise<any>;
  inputType?: 'input' | 'textarea';
  inputPlaceholder?: string;
  helpText?: {
    title: string;
    steps: string[];
    linkText?: string;
    linkUrl?: string;
  };
}

export function ApiKeyConfiguration({
  title,
  description,
  orgId,
  apiKeyHook,
  saveKey,
  inputType = 'input',
  inputPlaceholder,
  helpText,
}: ApiKeyConfigurationProps) {
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const hasApiKey = !!apiKeyHook.apiKey;

  const handleSave = async () => {
    if (!apiKey.trim()) {
      toast({
        title: 'API Key Required',
        description: 'Please enter your API key',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsSaving(true);
      await saveKey(apiKey);

      toast({
        title: 'API Key Saved',
        description: 'Your API key has been saved successfully',
      });

      setApiKey('');
      setShowDialog(false);
      apiKeyHook.mutate();
    } catch (error) {
      console.error('Error setting up API key:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save API key. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">API Key</h3>
              <p className="text-sm text-muted-foreground">
                {hasApiKey ? 'Your API key is configured' : 'No API key configured'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={hasApiKey ? "default" : "secondary"}>
                {hasApiKey ? "Configured" : "Not Configured"}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowDialog(true)}
              >
                <Key className="h-4 w-4 mr-2" />
                {hasApiKey ? "Update" : "Configure"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className={`${inputType === 'textarea' ? 'sm:max-w-[600px]' : 'sm:max-w-[500px]'} max-h-[90vh] overflow-y-auto overflow-x-hidden`}>
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Configure {title}
              </div>
            </DialogTitle>
            <DialogDescription>
              {description}
            </DialogDescription>
          </DialogHeader>

          {helpText && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{helpText.title}</AlertTitle>
              <AlertDescription className="space-y-2 mt-2">
                <ol className="list-decimal list-inside space-y-1 text-sm">
                  {helpText.steps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
                {helpText.linkText && helpText.linkUrl && (
                  <p className="text-sm mt-2">
                    <a
                      href={helpText.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {helpText.linkText} →
                    </a>
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="apiKey">{inputType === 'textarea' ? 'Service Account JSON Key' : 'API Key'}</Label>
            {inputType === 'textarea' ? (
              <Textarea
                id="apiKey"
                placeholder={inputPlaceholder || "Paste your JSON key here"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                rows={6}
                className="font-mono text-xs resize-none min-w-0 w-full"
                style={{ fieldSizing: 'fixed' } as React.CSSProperties}
              />
            ) : (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="apiKey"
                    type={showApiKey ? "text" : "password"}
                    placeholder={inputPlaceholder || "Enter your API key"}
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
                    {showApiKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                    <span className="sr-only">
                      {showApiKey ? "Hide" : "Show"} API key
                    </span>
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !apiKey.trim()}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
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
    </>
  );
}
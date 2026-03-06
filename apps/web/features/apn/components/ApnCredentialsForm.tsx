'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SaveApnCredentialsSchema } from '@auto-rfp/core';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { AlertCircle, Key, Loader2, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useSaveApnCredentials } from '../hooks/useSaveApnCredentials';
import { useApnCredentials } from '../hooks/useApnCredentials';

interface ApnCredentialsFormProps {
  orgId: string;
  onSaved?: () => void;
}

type FormValues = z.input<typeof SaveApnCredentialsSchema>;

export const ApnCredentialsForm = ({ orgId, onSaved }: ApnCredentialsFormProps) => {
  const { credentials, isLoading: isLoadingCreds, refresh } = useApnCredentials(orgId);
  const { save, isLoading: isSaving } = useSaveApnCredentials();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(SaveApnCredentialsSchema),
    defaultValues: { orgId, region: 'us-east-1' },
  });

  const isConfigured = credentials?.configured ?? false;

  const onSubmit = async (values: FormValues) => {
    const ok = await save(values);
    if (ok) {
      toast({
        title: 'APN Credentials Saved',
        description: 'Your AWS Partner Network credentials have been saved successfully.',
      });
      reset({ orgId, region: 'us-east-1' });
      setShowDialog(false);
      refresh();
      onSaved?.();
    } else {
      toast({
        title: 'Error',
        description: 'Failed to save APN credentials. Please try again.',
        variant: 'destructive',
      });
    }
  };

  if (isLoadingCreds) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72 mt-1" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-28" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>AWS Partner Network (APN)</CardTitle>
          <CardDescription>
            Configure your AWS Partner Central credentials to automatically register proposal submissions in the APN portal
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">Partner Central Credentials</h3>
              {isConfigured ? (
                <p className="text-sm text-muted-foreground">
                  Partner ID: <span className="font-mono font-medium">{credentials?.partnerId}</span>
                  {credentials?.region && credentials.region !== 'us-east-1' && (
                    <span className="ml-2 text-xs">· {credentials.region}</span>
                  )}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">No credentials configured</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={isConfigured ? 'default' : 'secondary'}>
                {isConfigured ? 'Configured' : 'Not Configured'}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowDialog(true)}
              >
                <Key className="h-4 w-4 mr-2" />
                {isConfigured ? 'Update' : 'Configure'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={(open) => {
        setShowDialog(open);
        if (!open) reset({ orgId, region: 'us-east-1' });
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Configure AWS Partner Network
            </DialogTitle>
            <DialogDescription>
              Enter your AWS Partner Central credentials to enable automatic opportunity registration.
            </DialogDescription>
          </DialogHeader>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>How to get your credentials</AlertTitle>
            <AlertDescription className="space-y-1 mt-2">
              <ol className="list-decimal list-inside space-y-1 text-sm">
                <li>Sign in to <a href="https://partnercentral.awspartner.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">AWS Partner Central</a></li>
                <li>Go to <strong>Settings → API Access</strong></li>
                <li>Create a new IAM user with <code className="text-xs bg-muted px-1 rounded">partnercentral:*</code> permissions</li>
                <li>Copy the Partner ID, Access Key ID, and Secret Access Key</li>
              </ol>
            </AlertDescription>
          </Alert>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <input type="hidden" {...register('orgId')} />

            <div className="space-y-1.5">
              <Label htmlFor="partnerId">AWS Partner ID</Label>
              <Input
                id="partnerId"
                {...register('partnerId')}
                placeholder="e.g. 0010000000XXXXXX"
              />
              {errors.partnerId && (
                <p className="text-xs text-destructive">{errors.partnerId.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="accessKeyId">Access Key ID</Label>
              <Input
                id="accessKeyId"
                {...register('accessKeyId')}
                placeholder="AKIA…"
                className="font-mono text-sm"
              />
              {errors.accessKeyId && (
                <p className="text-xs text-destructive">{errors.accessKeyId.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="secretAccessKey">Secret Access Key</Label>
              <div className="relative">
                <Input
                  id="secretAccessKey"
                  {...register('secretAccessKey')}
                  type={showSecret ? 'text' : 'password'}
                  placeholder="••••••••••••••••••••••••••••••••••••••••"
                  className="font-mono text-sm pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowSecret(!showSecret)}
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  <span className="sr-only">{showSecret ? 'Hide' : 'Show'} secret</span>
                </Button>
              </div>
              {errors.secretAccessKey && (
                <p className="text-xs text-destructive">{errors.secretAccessKey.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="region">
                Region <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="region"
                {...register('region')}
                placeholder="us-east-1"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Default: us-east-1</p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDialog(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Key className="mr-2 h-4 w-4" />
                    {isConfigured ? 'Update Credentials' : 'Save Credentials'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

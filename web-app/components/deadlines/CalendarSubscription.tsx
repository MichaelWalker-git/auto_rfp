'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar, Copy, Check, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

interface CalendarSubscriptionProps {
  orgId: string;
}

// Build subscription URL from token
function buildSubscriptionUrl(orgId: string, token: string): string {
  return `${env.BASE_API_URL}/deadlines/subscribe/${orgId}/calendar.ics?token=${token}`;
}

// Fallback clipboard copy for older browsers/http
async function copyToClipboardWithFallback(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy method
    }
  }
  
  // Legacy fallback: create temporary textarea
  const textArea = document.createElement('textarea');
  textArea.value = text;
  
  // Prevent scrolling to bottom on iOS
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.position = 'fixed';
  textArea.style.width = '2em';
  textArea.style.height = '2em';
  textArea.style.padding = '0';
  textArea.style.border = 'none';
  textArea.style.outline = 'none';
  textArea.style.boxShadow = 'none';
  textArea.style.background = 'transparent';
  textArea.setAttribute('readonly', '');
  
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  // For iOS
  textArea.setSelectionRange(0, text.length);
  
  let success = false;
  try {
    success = document.execCommand('copy');
  } catch {
    success = false;
  }
  
  document.body.removeChild(textArea);
  return success;
}

export default function CalendarSubscription({ orgId }: CalendarSubscriptionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [subscriptionUrl, setSubscriptionUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const fetchSubscription = async () => {
    setIsLoading(true);
    try {
      const response = await authFetcher(
        `${env.BASE_API_URL}/deadlines/subscription/${orgId}`,
        { method: 'GET' }
      );

      if (!response.ok) {
        throw new Error('Failed to get subscription');
      }

      const data = await response.json();
      const token = data.subscription?.token;
      
      if (token) {
        setSubscriptionUrl(buildSubscriptionUrl(orgId, token));
      } else {
        setSubscriptionUrl(null);
      }
    } catch (err) {
      console.error('Error fetching subscription:', err);
      toast({
        title: 'Error',
        description: 'Failed to load calendar subscription.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const regenerateSubscription = async () => {
    setIsRegenerating(true);
    try {
      const response = await authFetcher(
        `${env.BASE_API_URL}/deadlines/subscription/${orgId}/regenerate`,
        { method: 'POST' }
      );

      if (!response.ok) {
        throw new Error('Failed to regenerate subscription');
      }

      const data = await response.json();
      const token = data.subscription?.token;
      
      if (token) {
        setSubscriptionUrl(buildSubscriptionUrl(orgId, token));
      }
      
      toast({
        title: 'Token Regenerated',
        description: 'Previous subscription URLs will no longer work.',
      });
    } catch (err) {
      console.error('Error regenerating subscription:', err);
      toast({
        title: 'Error',
        description: 'Failed to regenerate subscription.',
        variant: 'destructive',
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  const copyToClipboard = async () => {
    if (!subscriptionUrl) return;
    
    const success = await copyToClipboardWithFallback(subscriptionUrl);
    
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: 'Copied!',
        description: 'Subscription URL copied to clipboard.',
      });
    } else {
      toast({
        title: 'Copy manually',
        description: 'Click the URL field to select it, then press Ctrl+C (or Cmd+C on Mac).',
      });
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open && !subscriptionUrl) {
      fetchSubscription();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Calendar className="h-4 w-4 mr-2" />
          Subscribe
        </Button>
      </DialogTrigger>
      
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Subscribe to Calendar
          </DialogTitle>
          <DialogDescription>
            Add this URL to Google Calendar, Outlook, or Apple Calendar to automatically sync deadlines.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Security Warning */}
          <Alert variant="default" className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800 dark:text-amber-200">
              <strong>Security notice:</strong> Anyone with this URL can view your organization&apos;s deadlines. 
              Do not share this link publicly.
            </AlertDescription>
          </Alert>

          {/* Subscription URL */}
          <div className="space-y-2">
            <Label htmlFor="subscription-url">Subscription URL</Label>
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  id="subscription-url"
                  value={subscriptionUrl || ''}
                  readOnly
                  className="font-mono text-xs"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyToClipboard}
                  disabled={!subscriptionUrl}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="space-y-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">How to use:</p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>Google Calendar:</strong> Settings → Add calendar → From URL</li>
              <li><strong>Apple Calendar:</strong> File → New Calendar Subscription</li>
              <li><strong>Outlook:</strong> Add calendar → Subscribe from web</li>
            </ul>
            <p className="text-xs mt-2">
              Note: External calendars refresh every 12-24 hours. New deadlines will appear automatically.
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={regenerateSubscription}
            disabled={isRegenerating}
            className="w-full sm:w-auto"
          >
            {isRegenerating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Regenerate Token
          </Button>
          <Button onClick={() => setIsOpen(false)} className="w-full sm:w-auto">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
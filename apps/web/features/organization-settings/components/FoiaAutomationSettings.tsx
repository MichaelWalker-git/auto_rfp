'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Settings, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { PermissionButton } from '@/components/ui/permission-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { useFoiaSettings, useUpdateFoiaSettings } from '@/lib/hooks/use-foia-settings';
import { FoiaSettingsUpdateRequestSchema, DEFAULT_FOIA_DELAY_DAYS } from '@auto-rfp/core';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FoiaAutomationSettingsProps {
  orgId: string;
}

type FoiaSettingsFormValues = z.input<typeof FoiaSettingsUpdateRequestSchema>;

// ─── Component ────────────────────────────────────────────────────────────────

export const FoiaAutomationSettings = ({ orgId }: FoiaAutomationSettingsProps) => {
  const { toast } = useToast();
  const { settings, isLoading, mutate } = useFoiaSettings(orgId);
  const { updateFoiaSettings, isSaving } = useUpdateFoiaSettings(orgId, mutate);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isDirty, isValid },
  } = useForm<FoiaSettingsFormValues>({
    resolver: zodResolver(FoiaSettingsUpdateRequestSchema),
    mode: 'onChange',
    defaultValues: {
      automationEnabled: true,
      delayDays: DEFAULT_FOIA_DELAY_DAYS,
      mailScrapeEnabled: false,
      autoSendTrusted: false,
      stallAfterDays: 14,
      dailySendCap: 5,
      defaultFeeLimit: 0,
    },
  });

  const automationEnabled = watch('automationEnabled');
  const mailScrapeEnabled = watch('mailScrapeEnabled');
  const autoSendTrusted = watch('autoSendTrusted');

  useEffect(() => {
    if (settings) {
      setValue('automationEnabled', settings.automationEnabled ?? true);
      setValue('delayDays', settings.delayDays ?? DEFAULT_FOIA_DELAY_DAYS);
      setValue('scrapeMailbox', settings.scrapeMailbox ?? undefined);
      setValue('mailScrapeEnabled', settings.mailScrapeEnabled ?? false);
      setValue('autoSendTrusted', settings.autoSendTrusted ?? false);
      setValue('approverUserId', settings.approverUserId ?? undefined);
      setValue('stallAfterDays', settings.stallAfterDays ?? 14);
      setValue('dailySendCap', settings.dailySendCap ?? 5);
      setValue('defaultFeeLimit', settings.defaultFeeLimit ?? 0);
    }
  }, [settings, setValue]);

  const onSubmit = async (values: FoiaSettingsFormValues) => {
    try {
      await updateFoiaSettings(values);
      toast({
        title: 'FOIA settings saved',
        description: 'Automation preferences have been updated.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save FOIA settings',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-1" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0">
            <Settings className="h-5 w-5 text-indigo-500" />
          </div>
          <div>
            <CardTitle className="text-base">FOIA Automation</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Automatic Freedom of Information Act request settings
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <Separator />

      <form onSubmit={handleSubmit(onSubmit)} id="foia-settings-form">
        <CardContent className="pt-5 space-y-5">
          {/* Master switch */}
          <div className="flex items-center justify-between space-x-2">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="automation-enabled" className="text-sm font-medium">
                Enable FOIA automation
              </Label>
              <p className="text-xs text-muted-foreground">
                Schedule and prepare FOIA requests automatically for won and lost opportunities.
              </p>
            </div>
            <Switch
              id="automation-enabled"
              checked={automationEnabled ?? true}
              onCheckedChange={(checked) => setValue('automationEnabled', checked, { shouldDirty: true })}
            />
          </div>

          <Separator />

          {/* Auto-send without approval */}
          <div className="flex items-center justify-between space-x-2">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="auto-send-trusted" className="text-sm font-medium">
                Send without approval
              </Label>
              <p className="text-xs text-muted-foreground">
                Transmit automatically when the FOIA address comes from the government&apos;s own
                published directory or an address someone here already confirmed. Requests whose
                address was inferred from a solicitation document always wait for approval.
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Requires a verified sending domain. Leave off until DNS and SES are configured —
                agency mail servers reject unauthenticated mail silently.
              </p>
            </div>
            <Switch
              id="auto-send-trusted"
              checked={autoSendTrusted ?? false}
              onCheckedChange={(checked) => setValue('autoSendTrusted', checked, { shouldDirty: true })}
            />
          </div>

          <Separator />

          {/* Delay days */}
          <div className="space-y-1.5">
            <Label htmlFor="delay-days" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Delay Days <span className="text-destructive">*</span>
            </Label>
            <Input
              id="delay-days"
              type="number"
              min="0"
              max="3650"
              className="h-9 text-sm"
              {...register('delayDays', { valueAsNumber: true })}
            />
            <p className="text-xs text-muted-foreground">
              Days after submission before the FOIA request is prepared (default: {DEFAULT_FOIA_DELAY_DAYS})
            </p>
            {errors.delayDays && <p className="text-xs text-destructive">{errors.delayDays.message}</p>}
          </div>

          <Separator />

          {/* Mail scraping (Level 1) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between space-x-2">
              <div className="space-y-0.5 flex-1">
                <Label htmlFor="mail-scrape-enabled" className="text-sm font-medium">
                  Email scraping (Level 1)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Monitor a mailbox for award/cancellation notices to trigger early FOIA requests.
                </p>
              </div>
              <Switch
                id="mail-scrape-enabled"
                checked={mailScrapeEnabled ?? false}
                onCheckedChange={(checked) => setValue('mailScrapeEnabled', checked, { shouldDirty: true })}
              />
            </div>

            {mailScrapeEnabled && (
              <div className="space-y-1.5 pl-4">
                <Label htmlFor="scrape-mailbox" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Scrape Mailbox
                </Label>
                <Input
                  id="scrape-mailbox"
                  type="email"
                  className="h-9 text-sm"
                  placeholder="awards@company.com"
                  {...register('scrapeMailbox')}
                />
                <p className="text-xs text-muted-foreground">
                  The email address to scan daily. Note: Level 1 scraping is not yet fully enabled.
                </p>
                {errors.scrapeMailbox && <p className="text-xs text-destructive">{errors.scrapeMailbox.message}</p>}
              </div>
            )}
          </div>

          <Separator />

          {/* Approver user ID */}
          <div className="space-y-1.5">
            <Label htmlFor="approver-user-id" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Approver User ID
            </Label>
            <Input
              id="approver-user-id"
              type="text"
              className="h-9 text-sm"
              placeholder="user-123"
              {...register('approverUserId')}
            />
            <p className="text-xs text-muted-foreground">
              Who must approve sends. Falls back to opportunity assignee, then org primary contact, then org admins.
              (A user picker would be better here.)
            </p>
            {errors.approverUserId && <p className="text-xs text-destructive">{errors.approverUserId.message}</p>}
          </div>

          <Separator />

          {/* Stall after days */}
          <div className="space-y-1.5">
            <Label htmlFor="stall-after-days" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Stall After Days <span className="text-destructive">*</span>
            </Label>
            <Input
              id="stall-after-days"
              type="number"
              min="1"
              max="365"
              className="h-9 text-sm"
              {...register('stallAfterDays', { valueAsNumber: true })}
            />
            <p className="text-xs text-muted-foreground">
              Days after which an unapproved request is marked as stalled (default: 14)
            </p>
            {errors.stallAfterDays && <p className="text-xs text-destructive">{errors.stallAfterDays.message}</p>}
          </div>

          <Separator />

          {/* Daily send cap */}
          <div className="space-y-1.5">
            <Label htmlFor="daily-send-cap" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Daily Send Cap <span className="text-destructive">*</span>
            </Label>
            <Input
              id="daily-send-cap"
              type="number"
              min="1"
              max="100"
              className="h-9 text-sm"
              {...register('dailySendCap', { valueAsNumber: true })}
            />
            <p className="text-xs text-muted-foreground">
              Maximum automated FOIA sends per UTC day (default: 5)
            </p>
            {errors.dailySendCap && <p className="text-xs text-destructive">{errors.dailySendCap.message}</p>}
          </div>

          <Separator />

          {/* Default fee limit */}
          <div className="space-y-1.5">
            <Label htmlFor="default-fee-limit" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Default Fee Limit <span className="text-destructive">*</span>
            </Label>
            <Input
              id="default-fee-limit"
              type="number"
              min="0"
              step="0.01"
              className="h-9 text-sm"
              {...register('defaultFeeLimit', { valueAsNumber: true })}
            />
            <p className="text-xs text-muted-foreground">
              Default fee ceiling on composed requests. 0 asks for a fee waiver.
            </p>
            {errors.defaultFeeLimit && <p className="text-xs text-destructive">{errors.defaultFeeLimit.message}</p>}
          </div>

          {/* Save button */}
          <div className="flex justify-end pt-1">
            <PermissionButton
              requiredPermission="org:manage_settings"
              type="submit"
              size="sm"
              disabled={isSaving || !isDirty || !isValid}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save Settings'
              )}
            </PermissionButton>
          </div>
        </CardContent>
      </form>
    </Card>
  );
};

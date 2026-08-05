'use client';

import * as React from 'react';
import { parseAsStringLiteral, useQueryState } from 'nuqs';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';

import { RefreshCw } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { CreatePromptDialog } from '@/components/organizations/CreatePromptDialog';
import { FeaturePromptsTab, type FeaturePromptSaveArgs, normalizeParams } from '@/components/organizations/FeaturePromptsTab';
import { DocumentPromptsTab } from '@/components/organizations/DocumentPromptsTab';
import type {
  DocumentPromptResetArgs,
  DocumentPromptSaveArgs,
} from '@/components/organizations/DocumentPromptRow';

import { PromptScopeSchema, PromptTypeSchema, RFP_DOCUMENT_TYPES } from '@auto-rfp/core';

import { useDeletePrompt, usePrompts, useSavePrompt } from '@/lib/hooks/use-prompt';
import { useCurrentOrganization } from '@/context/organization-context';

const TAB_VALUES = ['features', 'documents'] as const;

export function PromptsManager() {
  const { toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringLiteral(TAB_VALUES).withDefault('features'),
  );

  const { currentOrganization } = useCurrentOrganization();
  const { system, user, document, isLoading, error, refresh } = usePrompts(currentOrganization?.id);
  const { trigger: saveTrigger, isMutating: isSaving } = useSavePrompt(currentOrganization?.id);
  const { trigger: deleteTrigger, isMutating: isDeleting } = useDeletePrompt(currentOrganization?.id);

  React.useEffect(() => {
    if (error) {
      toast({
        title: 'Failed to load prompts',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }, [error, toast]);

  const onSaveFeature = async (args: FeaturePromptSaveArgs) => {
    const { success, data: scope } = PromptScopeSchema.safeParse(args.scope);
    if (!success) {
      toast({ title: 'Invalid scope', description: 'Use SYSTEM or USER', variant: 'destructive' });
      return;
    }

    const { success: typeOk, data: type } = PromptTypeSchema.safeParse(args.type);
    if (!typeOk) {
      toast({ title: 'Invalid type', description: `Unknown prompt type ${args.type}`, variant: 'destructive' });
      return;
    }

    try {
      await saveTrigger({
        scope,
        type,
        prompt: args.prompt,
        params: normalizeParams(args.params),
        orgId: currentOrganization?.id,
      });
      await refresh();
      toast({ title: 'Saved', description: `${args.scope} ${args.type} prompt updated.` });
    } catch (e) {
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  };

  const onSaveDocument = async (args: DocumentPromptSaveArgs) => {
    try {
      await saveTrigger({
        scope: args.scope,
        documentType: args.documentType,
        prompt: args.prompt,
        orgId: currentOrganization?.id,
      });
      await refresh();
      toast({
        title: 'Saved',
        description: `${RFP_DOCUMENT_TYPES[args.documentType]} ${args.scope === 'SYSTEM' ? 'guidance' : 'task instructions'} updated.`,
      });
    } catch (e) {
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  };

  const onResetDocument = async (args: DocumentPromptResetArgs) => {
    const ok = await confirm({
      title: 'Reset to default?',
      description: `The customized ${args.scope === 'SYSTEM' ? 'guidance' : 'task instructions'} for ${RFP_DOCUMENT_TYPES[args.documentType]} will be deleted and the built-in default will apply again.`,
      confirmLabel: 'Reset',
      variant: 'destructive',
    });
    if (!ok) return;

    try {
      await deleteTrigger({ scope: args.scope, documentType: args.documentType });
      await refresh();
      toast({
        title: 'Reset',
        description: `${RFP_DOCUMENT_TYPES[args.documentType]} reverted to the default.`,
      });
    } catch (e) {
      toast({
        title: 'Reset failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  };

  const isBusy = isSaving || isDeleting;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prompts"
        description="System prompts are defaults; user prompts override at runtime."
        actions={
          <>
            {tab === 'features' ? (
              <CreatePromptDialog triggerLabel="New prompt" onSaved={refresh} disabled={isLoading || isBusy}/>
            ) : null}
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => refresh()}
              disabled={isLoading || isBusy}
            >
              <RefreshCw className="h-4 w-4"/>
              Refresh
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v === 'documents' ? 'documents' : 'features')}>
        <TabsList>
          <TabsTrigger value="features">AI Features</TabsTrigger>
          <TabsTrigger value="documents">Document Generation</TabsTrigger>
        </TabsList>

        <TabsContent value="features" className="pt-4">
          <FeaturePromptsTab
            system={system}
            user={user}
            isLoading={isLoading}
            isSaving={isBusy}
            onSave={onSaveFeature}
          />
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          <DocumentPromptsTab
            documentPrompts={document}
            isLoading={isLoading}
            isSaving={isBusy}
            onSave={onSaveDocument}
            onReset={onResetDocument}
          />
        </TabsContent>
      </Tabs>

      <ConfirmDialog/>
    </div>
  );
}

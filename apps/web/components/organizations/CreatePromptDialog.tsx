'use client';

import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import { Loader2, Plus, Save, Shield, User, X } from 'lucide-react';

import {
  type PromptScope,
  PromptScopeSchema,
  type PromptType,
  PromptTypeSchema,
  SavePromptBodySchema,
} from '@auto-rfp/core';

import { useSavePrompt } from '@/lib/hooks/use-prompt';

const SCOPE_VALUES = PromptScopeSchema.options;
const TYPE_VALUES = PromptTypeSchema.options;

function normalizeParams(params?: string[]) {
  return (params ?? []).map((p) => String(p).trim()).filter(Boolean);
}

function ScopeBadge({ scope }: { scope: PromptScope }) {
  return scope === 'SYSTEM' ? (
    <Badge className="gap-1">
      <Shield className="h-3.5 w-3.5"/>
      SYSTEM
    </Badge>
  ) : (
    <Badge variant="secondary" className="gap-1">
      <User className="h-3.5 w-3.5"/>
      USER
    </Badge>
  );
}

export function CreatePromptDialog(props: {
  triggerLabel?: string;
  defaultScope?: PromptScope;
  defaultType?: PromptType;
  onSaved?: () => void;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const { triggerLabel = 'New prompt', defaultScope = 'SYSTEM', defaultType, onSaved, disabled } = props;

  const { trigger: saveTrigger, isMutating: isSaving } = useSavePrompt();

  const [open, setOpen] = React.useState(false);

  const [scope, setScope] = React.useState<PromptScope>(defaultScope);
  const [type, setType] = React.useState<PromptType>(defaultType ?? TYPE_VALUES[0]);
  const [prompt, setPrompt] = React.useState('');
  const [params, setParams] = React.useState<string[]>([]);
  const [paramDraft, setParamDraft] = React.useState('');

  // reset on open
  React.useEffect(() => {
    if (!open) return;
    setScope(defaultScope);
    setType(defaultType ?? TYPE_VALUES[0]);
    setPrompt('');
    setParams([]);
    setParamDraft('');
  }, [open, defaultScope, defaultType]);

  const addParam = () => {
    const p = paramDraft.trim();
    if (!p) return;
    setParams((prev) => Array.from(new Set([...prev, p])));
    setParamDraft('');
  };

  const removeParam = (p: string) => setParams((prev) => prev.filter((x) => x !== p));

  const onSubmit = async () => {
    const scopeOk = PromptScopeSchema.safeParse(scope);
    if (!scopeOk.success) {
      toast({ title: 'Invalid scope', description: 'Use SYSTEM or USER', variant: 'destructive' });
      return;
    }

    const bodyOk = SavePromptBodySchema.safeParse({
      type,
      prompt,
      params: normalizeParams(params),
    });

    if (!bodyOk.success) {
      toast({
        title: 'Invalid input',
        description: bodyOk.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '),
        variant: 'destructive',
      });
      return;
    }

    try {
      await saveTrigger({ scope: scopeOk.data, ...bodyOk.data } as any);
      toast({ title: 'Saved', description: `${scopeOk.data} ${bodyOk.data.type} prompt saved.` });
      setOpen(false);
      onSaved?.();
    } catch (e: any) {
      toast({
        title: 'Save failed',
        description: e?.message ?? String(e),
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2" disabled={disabled}>
          <Plus className="h-4 w-4"/>
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>Create prompt</span>
            <div className="flex items-center gap-2">
              <ScopeBadge scope={scope}/>
              <Badge variant="outline">{type}</Badge>
            </div>
          </DialogTitle>
          <DialogDescription>System = default, User = override.</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto pr-1 max-h-[calc(85vh-160px)]">
          <div className="grid gap-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Scope</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as PromptScope)}
                  disabled={isSaving}
                >
                  {SCOPE_VALUES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <Label>Type</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={type}
                  onChange={(e) => setType(e.target.value as PromptType)}
                  disabled={isSaving}
                >
                  {TYPE_VALUES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Prompt</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Write prompt text…"
                className="min-h-[200px] resize-y rounded-xl"
                disabled={isSaving}
              />
            </div>

            <div className="grid gap-2">
              <Label>Runtime params (optional)</Label>
              <div className="flex gap-2">
                <Input
                  value={paramDraft}
                  onChange={(e) => setParamDraft(e.target.value)}
                  placeholder="e.g. TIMESTAMP_ISO"
                  className="rounded-xl"
                  disabled={isSaving}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addParam();
                    }
                  }}
                />
                <Button type="button" variant="outline" className="rounded-xl" onClick={addParam} disabled={isSaving}>
                  <Plus className="h-4 w-4"/>
                </Button>
              </div>

              {params.length ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  {params.map((p) => (
                    <Badge key={p} variant="secondary" className="gap-1">
                      {p}
                      <button
                        type="button"
                        className="ml-1 rounded hover:bg-muted/40"
                        onClick={() => removeParam(p)}
                        aria-label={`Remove ${p}`}
                        disabled={isSaving}
                      >
                        <X className="h-3.5 w-3.5"/>
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No params yet.</div>
              )}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <DialogClose asChild>
            <Button variant="outline" disabled={isSaving}>
              Cancel
            </Button>
          </DialogClose>

          <Button onClick={onSubmit} disabled={isSaving || !prompt.trim()} className="gap-2">
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin"/>
                Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4"/>
                Save
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
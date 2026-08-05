'use client';

import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PermissionButton } from '@/components/ui/permission-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';

import { ChevronsUpDown, Plus, Save, Settings2, Shield, User, X } from 'lucide-react';

import type { PromptItem, PromptScope } from '@auto-rfp/core';
import { PromptTypeSchema } from '@auto-rfp/core';

/** Feature types no longer editable here: RFP_DOCUMENT/TECHNICAL_PROPOSAL moved to
 *  the Document Generation tab; PROPOSAL is dead. Enum values + DB rows are kept. */
const HIDDEN_FEATURE_TYPES = new Set(['RFP_DOCUMENT', 'PROPOSAL', 'TECHNICAL_PROPOSAL']);

export interface FeaturePromptSaveArgs {
  scope: PromptScope;
  type: string;
  prompt: string;
  params: string[];
}

const byTypeMap = (items: PromptItem[]) => {
  const m = new Map<string, PromptItem>();
  for (const it of items) if (it.type) m.set(it.type, it);
  return m;
};

export const normalizeParams = (params?: string[]) =>
  (params ?? []).map((p) => String(p).trim()).filter(Boolean);

const updatedLabel = (iso?: string | null) => {
  if (!iso) return 'Not set yet';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Updated';
  return `Updated ${d.toLocaleString()}`;
};

const ScopeBadge = ({ scope }: { scope: PromptScope }) => {
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
};

const PromptRow = ({
                     scope,
                     type,
                     current,
                     onSave,
                     isSaving,
                   }: {
  scope: PromptScope;
  type: string;
  current?: PromptItem | null;
  onSave: (args: FeaturePromptSaveArgs) => Promise<void>;
  isSaving: boolean;
}) => {
  const [prompt, setPrompt] = React.useState(current?.prompt ?? '');
  const [params, setParams] = React.useState<string[]>(normalizeParams(current?.params));
  const [paramDraft, setParamDraft] = React.useState('');
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    setPrompt(current?.prompt ?? '');
    setParams(normalizeParams(current?.params));
  }, [current?.prompt, current?.params]);

  const dirty =
    (current?.prompt ?? '') !== prompt ||
    JSON.stringify(normalizeParams(current?.params)) !== JSON.stringify(normalizeParams(params));

  const addParam = () => {
    const p = paramDraft.trim();
    if (!p) return;
    setParams((prev) => Array.from(new Set([...prev, p])));
    setParamDraft('');
  };

  const removeParam = (p: string) => setParams((prev) => prev.filter((x) => x !== p));

  return (
    <div className="rounded-2xl border bg-background shadow-sm">
      {/* header */}
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ScopeBadge scope={scope}/>
            <Badge variant="outline">{type}</Badge>
            <span className="text-xs text-muted-foreground">{updatedLabel(current?.updatedAt)}</span>
            {dirty ? <Badge variant="secondary">Unsaved</Badge> : null}
          </div>

          {!expanded ? (
            <div className="rounded-xl bg-muted/30 p-3 text-xs text-muted-foreground">
              {prompt.trim()
                ? `${prompt.trim().slice(0, 260)}${prompt.trim().length > 260 ? '…' : ''}`
                : 'No prompt yet. Click “Edit” to add one.'}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 rounded-xl"
            onClick={() => setExpanded((v) => !v)}
          >
            <ChevronsUpDown className="h-4 w-4"/>
            {expanded ? 'Collapse' : 'Edit'}
          </Button>

          <PermissionButton
            requiredPermission="prompt:create"
            size="sm"
            disabled={!dirty || isSaving}
            className="gap-2 rounded-xl"
            onClick={() => onSave({ scope, type, prompt, params })}
          >
            <Save className="h-4 w-4"/>
            Save
          </PermissionButton>
        </div>
      </div>

      {/* expanded editor */}
      {expanded ? (
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-2">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Write prompt text…"
              className="min-h-[320px] resize-y rounded-xl"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Tip: keep it deterministic.</span>
              <span>{prompt.trim().length.toLocaleString()} chars</span>
            </div>
          </div>

          <div className="rounded-2xl border bg-muted/20 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Settings2 className="h-4 w-4 text-muted-foreground"/>
                Runtime params
              </div>
              <Badge variant="outline">{params.length}</Badge>
            </div>

            <div className="mt-3 flex gap-2">
              <Input
                value={paramDraft}
                onChange={(e) => setParamDraft(e.target.value)}
                placeholder="e.g. TIMESTAMP_ISO"
                className="rounded-xl"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addParam();
                  }
                }}
              />
              <Button type="button" variant="outline" className="rounded-xl" onClick={addParam}>
                <Plus className="h-4 w-4"/>
              </Button>
            </div>

            {params.length ? (
              <div className="mt-3 max-h-[280px] overflow-auto pr-1">
                <div className="flex flex-wrap gap-2">
                  {params.map((p) => (
                    <Badge key={p} variant="secondary" className="gap-1">
                      {p}
                      <button
                        type="button"
                        className="ml-1 rounded hover:bg-muted/40"
                        onClick={() => removeParam(p)}
                        aria-label={`Remove ${p}`}
                      >
                        <X className="h-3.5 w-3.5"/>
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed bg-background/40 p-3 text-xs text-muted-foreground">
                No params yet. Add placeholders you resolve at runtime.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const FeaturePromptsTab = ({
                                    system,
                                    user,
                                    isLoading,
                                    isSaving,
                                    onSave,
                                  }: {
  system: PromptItem[];
  user: PromptItem[];
  isLoading: boolean;
  isSaving: boolean;
  onSave: (args: FeaturePromptSaveArgs) => Promise<void>;
}) => {
  const systemMap = React.useMemo(() => byTypeMap(system), [system]);
  const userMap = React.useMemo(() => byTypeMap(user), [user]);

  const types = React.useMemo(() => {
    const set = new Set<string>();
    for (const it of system) if (it.type) set.add(it.type);
    for (const it of user) if (it.type) set.add(it.type);

    const known: readonly string[] = PromptTypeSchema.options;
    const knownSet = new Set(known);
    const list = Array.from(set);

    const ordered = [
      ...known.filter((k) => set.has(k)),
      ...list.filter((t) => !knownSet.has(t)).sort(),
    ];

    return ordered.filter((t) => !HIDDEN_FEATURE_TYPES.has(t));
  }, [system, user]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-[180px] w-full rounded-2xl"/>
        <Skeleton className="h-[180px] w-full rounded-2xl"/>
      </div>
    );
  }

  if (types.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        No prompts yet.
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {types.map((type) => {
        const sys = systemMap.get(type) ?? null;
        const usr = userMap.get(type) ?? null;

        return (
          <section key={type} className="space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-semibold">{type}</div>
            </div>

            <div className="space-y-3">
              <PromptRow scope="SYSTEM" type={type} current={sys} onSave={onSave} isSaving={isSaving}/>
              <PromptRow scope="USER" type={type} current={usr} onSave={onSave} isSaving={isSaving}/>
            </div>
          </section>
        );
      })}
    </div>
  );
};

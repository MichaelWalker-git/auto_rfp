'use client';

import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PermissionButton } from '@/components/ui/permission-button';
import { Textarea } from '@/components/ui/textarea';

import { ChevronsUpDown, RotateCcw, Save, Shield, User } from 'lucide-react';

import type { DocumentPromptItem, DocumentPromptType, PromptScope } from '@auto-rfp/core';
import { DOCUMENT_PROMPT_MAX_LENGTH } from '@auto-rfp/core';

export interface DocumentPromptSaveArgs {
  scope: PromptScope;
  documentType: DocumentPromptType;
  prompt: string;
}

export interface DocumentPromptResetArgs {
  scope: PromptScope;
  documentType: DocumentPromptType;
}

const SCOPE_LABELS: Record<PromptScope, string> = {
  SYSTEM: 'Guidance',
  USER: 'Task instructions',
};

const SCOPE_HINTS: Record<PromptScope, string> = {
  SYSTEM: 'Type-specific writing guidance injected into the system prompt.',
  USER: 'Type-specific task instructions injected into the user prompt.',
};

const updatedLabel = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Updated';
  return `Updated ${d.toLocaleString()}`;
};

const ScopeBadge = ({ scope }: { scope: PromptScope }) => {
  return scope === 'SYSTEM' ? (
    <Badge className="gap-1">
      <Shield className="h-3.5 w-3.5"/>
      {SCOPE_LABELS.SYSTEM}
    </Badge>
  ) : (
    <Badge variant="secondary" className="gap-1">
      <User className="h-3.5 w-3.5"/>
      {SCOPE_LABELS.USER}
    </Badge>
  );
};

/**
 * One fragment editor (guidance or task) for a document type. Pre-filled with the
 * default text when no org override exists; shows Default/Customized state and a
 * reset action that deletes the override row.
 */
export const DocumentPromptRow = ({
                                    scope,
                                    documentType,
                                    current,
                                    onSave,
                                    onReset,
                                    isSaving,
                                  }: {
  scope: PromptScope;
  documentType: DocumentPromptType;
  current?: DocumentPromptItem | null;
  onSave: (args: DocumentPromptSaveArgs) => Promise<void>;
  onReset: (args: DocumentPromptResetArgs) => Promise<void>;
  isSaving: boolean;
}) => {
  const [prompt, setPrompt] = React.useState(current?.prompt ?? '');
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    setPrompt(current?.prompt ?? '');
  }, [current?.prompt]);

  const isCustomized = Boolean(current) && !current?.isDefault;
  const dirty = (current?.prompt ?? '') !== prompt;
  const overLimit = prompt.length > DOCUMENT_PROMPT_MAX_LENGTH;
  const empty = prompt.trim().length === 0;
  const updated = isCustomized ? updatedLabel(current?.updatedAt) : null;

  return (
    <div className="rounded-2xl border bg-background shadow-sm">
      {/* header */}
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ScopeBadge scope={scope}/>
            {isCustomized ? (
              <Badge variant="default" className="bg-indigo-500 text-white hover:bg-indigo-500">
                Customized
              </Badge>
            ) : (
              <Badge variant="outline">Default</Badge>
            )}
            {updated ? <span className="text-xs text-muted-foreground">{updated}</span> : null}
            {dirty ? <Badge variant="secondary">Unsaved</Badge> : null}
          </div>

          {!expanded ? (
            <div className="rounded-xl bg-muted/30 p-3 text-xs text-muted-foreground">
              {prompt.trim()
                ? `${prompt.trim().slice(0, 260)}${prompt.trim().length > 260 ? '…' : ''}`
                : 'No text yet. Click “Edit” to add.'}
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

          {isCustomized ? (
            <PermissionButton
              requiredPermission="prompt:delete"
              variant="outline"
              size="sm"
              disabled={isSaving}
              className="gap-2 rounded-xl"
              onClick={() => onReset({ scope, documentType })}
            >
              <RotateCcw className="h-4 w-4"/>
              Reset to default
            </PermissionButton>
          ) : null}

          <PermissionButton
            requiredPermission="prompt:create"
            size="sm"
            disabled={!dirty || isSaving || overLimit || empty}
            className="gap-2 rounded-xl"
            onClick={() => onSave({ scope, documentType, prompt })}
          >
            <Save className="h-4 w-4"/>
            Save
          </PermissionButton>
        </div>
      </div>

      {/* expanded editor */}
      {expanded ? (
        <div className="space-y-2 border-t p-4">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Write fragment text…"
            aria-label={`${SCOPE_LABELS[scope]} for ${documentType}`}
            className="min-h-[280px] resize-y rounded-xl"
          />
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{SCOPE_HINTS[scope]}</span>
            <span className={overLimit ? 'font-medium text-destructive' : 'text-muted-foreground'}>
              {prompt.length.toLocaleString()} / {DOCUMENT_PROMPT_MAX_LENGTH.toLocaleString()} chars
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
};
